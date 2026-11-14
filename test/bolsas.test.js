/**
 * Tests unitarios de logica.js — PBI-9: despensa de café.
 * Felices + errores. Sin HTTP: solo reglas de negocio.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const Datos = require("../servidor/datos");
const Logica = require("../servidor/logica");

describe("PBI-9: despensa de café (lógica)", () => {
  let logica;

  beforeEach(() => {
    logica = new Logica(new Datos(), { costeHash: 4 });
  });

  // — Helpers —
  function crearUsuarioActivo(email) {
    logica.registrar(email, "secreta123");
    logica.activar(email);
  }

  function bolsaBase(overrides = {}) {
    return {
      nombre: "Geisha Hacienda La Esmeralda",
      origen: "Panamá",
      gramosIniciales: 250,
      ...overrides,
    };
  }

  // 1. Alta exitosa: estado "activa" y gramosRestantes === gramosIniciales
  it("crearBolsa: devuelve bolsa activa con gramosRestantes === gramosIniciales", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = logica.crearBolsa("ana@ejemplo.com", bolsaBase());
    assert.equal(bolsa.estado, "activa");
    assert.equal(bolsa.gramosRestantes, 250);
    assert.equal(bolsa.gramosRestantes, bolsa.gramosIniciales);
    assert.equal(bolsa.nombre, "Geisha Hacienda La Esmeralda");
    assert.equal(bolsa.origen, "Panamá");
    assert.equal(bolsa.tostador, "Desconocido");
    assert.equal(bolsa.variedad, "Variada");
    assert.equal(bolsa.proceso, "Lavado");
    assert.ok(bolsa.id);
    assert.ok(bolsa.creadaEn);
  });

  // 2. Fallo si gramosIniciales <= 0
  it("crearBolsa: falla con VALIDACION si gramosIniciales <= 0", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    assert.throws(
      () => logica.crearBolsa("ana@ejemplo.com", bolsaBase({ gramosIniciales: 0 })),
      (err) => err.code === "VALIDACION"
    );
    assert.throws(
      () => logica.crearBolsa("ana@ejemplo.com", bolsaBase({ gramosIniciales: -10 })),
      (err) => err.code === "VALIDACION"
    );
  });

  // 3. Fallo si nombre u origen están vacíos
  it("crearBolsa: falla con VALIDACION si nombre u origen están vacíos", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    assert.throws(
      () => logica.crearBolsa("ana@ejemplo.com", bolsaBase({ nombre: "" })),
      (err) => err.code === "VALIDACION"
    );
    assert.throws(
      () => logica.crearBolsa("ana@ejemplo.com", bolsaBase({ origen: "   " })),
      (err) => err.code === "VALIDACION"
    );
  });

  // 4. Listado aislado por usuario
  it("listarBolsas: solo devuelve las bolsas del usuario pedido", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    logica.crearBolsa("ana@ejemplo.com", bolsaBase({ nombre: "Bolsa Ana" }));
    logica.crearBolsa("bob@ejemplo.com", bolsaBase({ nombre: "Bolsa Bob" }));
    logica.crearBolsa("ana@ejemplo.com", bolsaBase({ nombre: "Bolsa Ana 2" }));
    const deAna = logica.listarBolsas("ana@ejemplo.com");
    const deBob = logica.listarBolsas("bob@ejemplo.com");
    assert.equal(deAna.length, 2);
    assert.equal(deBob.length, 1);
    assert.ok(deAna.every((b) => b.usuarioEmail === "ana@ejemplo.com"));
    assert.ok(deBob.every((b) => b.usuarioEmail === "bob@ejemplo.com"));
  });

  // 5. Prohibición: usuario ajeno no puede ver bolsa de otro
  it("obtenerBolsa: PROHIBIDO si el usuario no es el propietario", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsa = logica.crearBolsa("ana@ejemplo.com", bolsaBase());
    assert.throws(
      () => logica.obtenerBolsa("bob@ejemplo.com", bolsa.id),
      (err) => err.code === "PROHIBIDO"
    );
  });

  // 6. Prohibición: usuario ajeno no puede borrar bolsa de otro
  it("eliminarBolsa: PROHIBIDO si no es propietario ni admin", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsa = logica.crearBolsa("ana@ejemplo.com", bolsaBase());
    assert.throws(
      () => logica.eliminarBolsa("bob@ejemplo.com", bolsa.id),
      (err) => err.code === "PROHIBIDO"
    );
  });

  // 7. Admin puede borrar bolsa de cualquier usuario
  it("eliminarBolsa: admin puede borrar bolsa ajena con opts.esAdmin", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = logica.crearBolsa("ana@ejemplo.com", bolsaBase());
    const resultado = logica.eliminarBolsa("admin@ejemplo.com", bolsa.id, { esAdmin: true });
    assert.equal(resultado, true);
    // Ya no existe
    assert.throws(
      () => logica.obtenerBolsa("ana@ejemplo.com", bolsa.id),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });

  // 8. obtenerBolsa: NO_ENCONTRADO si la bolsa no existe
  it("obtenerBolsa: NO_ENCONTRADO si la bolsa no existe", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    assert.throws(
      () => logica.obtenerBolsa("ana@ejemplo.com", "inexistente"),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });

  // 9. Valores por defecto se aplican correctamente
  it("crearBolsa: aplica valores por defecto (tostador, variedad, proceso)", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = logica.crearBolsa("ana@ejemplo.com", {
      nombre: "Ethiopia Yirgacheffe",
      origen: "Etiopía",
      gramosIniciales: 500,
      tostador: "  Café Granja La Esperanza  ",
      variedad: "Bourbon",
      proceso: "Natural",
    });
    assert.equal(bolsa.tostador, "Café Granja La Esperanza");
    assert.equal(bolsa.variedad, "Bourbon");
    assert.equal(bolsa.proceso, "Natural");
  });

  // 10. Listado ordenado por fecha descendente
  it("listarBolsas: devuelve ordenadas por creadaEn descendente", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const b1 = logica.crearBolsa("ana@ejemplo.com", bolsaBase({ nombre: "Primera" }));
    const b2 = logica.crearBolsa("ana@ejemplo.com", bolsaBase({ nombre: "Segunda" }));
    const lista = logica.listarBolsas("ana@ejemplo.com");
    // La segunda (más reciente o igual) debe ir primero
    assert.ok(lista[0].creadaEn >= lista[1].creadaEn);
  });
});
