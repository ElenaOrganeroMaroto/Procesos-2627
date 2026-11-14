/**
 * Tests unitarios de logica.js — PBI-11: recetas de la comunidad, moderación y métricas.
 * Felices + errores y roles de administración. Sin HTTP: solo reglas de negocio.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const Datos = require("../servidor/datos");
const Logica = require("../servidor/logica");

describe("PBI-11: comunidad, moderación y métricas (lógica)", () => {
  let logica;

  beforeEach(() => {
    logica = new Logica(new Datos(), { costeHash: 4 });
  });

  // — Helpers —
  function crearUsuario(email, rol = "usuario") {
    logica.registrar(email, "secreta123");
    logica.activar(email);
    if (rol === "admin") {
      logica.inicializarAdmin(email);
    }
  }

  function crearBolsa(email, nombre = "Café Especial", origen = "Colombia", gramos = 500) {
    return logica.crearBolsa(email, {
      nombre,
      origen,
      gramosIniciales: gramos,
    });
  }

  // 1. listarComunidad solo incluye recetas públicas y excluye las privadas
  it("listarComunidad: solo incluye recetas públicas y excluye las privadas", () => {
    crearUsuario("ana@ejemplo.com");
    crearUsuario("bob@ejemplo.com");
    const bAna = crearBolsa("ana@ejemplo.com");
    const bBob = crearBolsa("bob@ejemplo.com");

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bAna.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bAna.id,
      metodo: "Aeropress",
      cafeGramos: 12,
      aguaGramos: 200,
      esPublica: false,
    });

    logica.registrarExtraccion("bob@ejemplo.com", {
      bolsaId: bBob.id,
      metodo: "Chemex",
      cafeGramos: 20,
      aguaGramos: 300,
      esPublica: true,
    });

    const comunidad = logica.listarComunidad();
    assert.equal(comunidad.length, 2);
    assert.ok(comunidad.every((e) => e.esPublica === true));
    const metodos = comunidad.map((e) => e.metodo);
    assert.ok(metodos.includes("V60"));
    assert.ok(metodos.includes("Chemex"));
    assert.ok(!metodos.includes("Aeropress"));
  });

  // 2. listarComunidad filtra correctamente por método y búsqueda de texto
  it("listarComunidad: filtra por método y por texto de búsqueda (insensible a mayúsculas)", () => {
    crearUsuario("ana@ejemplo.com");
    const b1 = crearBolsa("ana@ejemplo.com", "Geisha Hacienda", "Panamá");
    const b2 = crearBolsa("ana@ejemplo.com", "Bourbon Rosado", "Colombia");
    const b3 = crearBolsa("ana@ejemplo.com", "Etiopía Yirgacheffe", "Etiopía");

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b1.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b2.id,
      metodo: "v60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b3.id,
      metodo: "Espresso",
      cafeGramos: 18,
      aguaGramos: 36,
      esPublica: true,
    });

    // Filtro por método V60
    const soloV60 = logica.listarComunidad({ metodo: "v60" });
    assert.equal(soloV60.length, 2);

    // Filtro por búsqueda de origen
    const soloPanama = logica.listarComunidad({ buscar: "panamá" });
    assert.equal(soloPanama.length, 1);
    assert.equal(soloPanama[0].origen, "Panamá");

    // Filtro combinado método + búsqueda en nombre
    const combinado = logica.listarComunidad({ metodo: "V60", buscar: "bourbon" });
    assert.equal(combinado.length, 1);
    assert.equal(combinado[0].nombreCafe, "Bourbon Rosado");
  });

  // 3. moderarReceta: admin puede despublicar una receta ajena
  it("moderarReceta: admin puede despublicar una receta ajena y el cambio se persiste", () => {
    crearUsuario("admin@ejemplo.com", "admin");
    crearUsuario("ana@ejemplo.com");
    const b = crearBolsa("ana@ejemplo.com");

    const { extraccion } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    assert.equal(extraccion.esPublica, true);

    const moderada = logica.moderarReceta("admin@ejemplo.com", extraccion.id, "despublicar");
    assert.equal(moderada.esPublica, false);

    // Ya no aparece en comunidad
    const comunidad = logica.listarComunidad();
    assert.equal(comunidad.length, 0);

    // Persistida en datos
    const enDatos = logica.datos.buscarExtraccion(extraccion.id);
    assert.equal(enDatos.esPublica, false);
  });

  // 4. moderarReceta: admin puede eliminar una receta ajena
  it("moderarReceta: admin puede eliminar una receta y se borra de la persistencia", () => {
    crearUsuario("admin@ejemplo.com", "admin");
    crearUsuario("ana@ejemplo.com");
    const b = crearBolsa("ana@ejemplo.com");

    const { extraccion } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    const res = logica.moderarReceta("admin@ejemplo.com", extraccion.id, "eliminar");
    assert.deepEqual(res, { eliminada: true });

    assert.equal(logica.datos.buscarExtraccion(extraccion.id), null);
  });

  // 5. moderarReceta: usuario normal no puede moderar (PROHIBIDO)
  it("moderarReceta: usuario no admin recibe error PROHIBIDO", () => {
    crearUsuario("ana@ejemplo.com");
    crearUsuario("bob@ejemplo.com");
    const b = crearBolsa("ana@ejemplo.com");

    const { extraccion } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: true,
    });

    assert.throws(
      () => logica.moderarReceta("bob@ejemplo.com", extraccion.id, "despublicar"),
      (err) => err.code === "PROHIBIDO"
    );
  });

  // 6. moderarReceta: acción desconocida o receta inexistente
  it("moderarReceta: falla con VALIDACION en acción inválida y NO_ENCONTRADO si no existe", () => {
    crearUsuario("admin@ejemplo.com", "admin");
    crearUsuario("ana@ejemplo.com");
    const b = crearBolsa("ana@ejemplo.com");

    const { extraccion } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: b.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
    });

    assert.throws(
      () => logica.moderarReceta("admin@ejemplo.com", extraccion.id, "accion_desconocida"),
      (err) => err.code === "VALIDACION"
    );

    assert.throws(
      () => logica.moderarReceta("admin@ejemplo.com", "no-existe", "despublicar"),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });

  // 7. obtenerMetricasPlataforma: cálculo correcto para admin
  it("obtenerMetricasPlataforma: calcula métricas agregadas correctas para admin", () => {
    crearUsuario("admin@ejemplo.com", "admin");
    crearUsuario("ana@ejemplo.com");
    crearUsuario("bob@ejemplo.com");

    const bAna1 = crearBolsa("ana@ejemplo.com", "Geisha", "Panamá", 250);
    const bAna2 = crearBolsa("ana@ejemplo.com", "Bourbon", "Colombia", 250);
    const bBob = crearBolsa("bob@ejemplo.com", "Caturra", "Colombia", 250);

    // Extracciones
    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bAna1.id,
      metodo: "V60",
      cafeGramos: 15.5,
      aguaGramos: 250,
      puntuacion: 5,
    });

    logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bAna2.id,
      metodo: "V60",
      cafeGramos: 16.5,
      aguaGramos: 260,
      puntuacion: 4,
    });

    logica.registrarExtraccion("bob@ejemplo.com", {
      bolsaId: bBob.id,
      metodo: "Aeropress",
      cafeGramos: 18.0,
      aguaGramos: 200,
      puntuacion: 0, // No debe contar en promedio
    });

    const metricas = logica.obtenerMetricasPlataforma("admin@ejemplo.com");

    assert.equal(metricas.totalUsuarios, 3);
    assert.equal(metricas.totalBolsas, 3);
    assert.equal(metricas.totalExtracciones, 3);
    assert.equal(metricas.totalCafeGramosConsumidos, 50.0); // 15.5 + 16.5 + 18.0
    assert.equal(metricas.metodoMasPopular, "V60"); // 2 V60 vs 1 Aeropress
    assert.equal(metricas.origenMasConsumido, "Colombia"); // 2 Colombia vs 1 Panamá
    assert.equal(metricas.promedioPuntuacion, 4.5); // (5 + 4) / 2 = 4.5
  });

  // 8. obtenerMetricasPlataforma: sin extracciones devuelve valores seguros
  it("obtenerMetricasPlataforma: sistema vacío devuelve valores seguros por defecto", () => {
    crearUsuario("admin@ejemplo.com", "admin");
    const metricas = logica.obtenerMetricasPlataforma("admin@ejemplo.com");

    assert.equal(metricas.totalUsuarios, 1);
    assert.equal(metricas.totalBolsas, 0);
    assert.equal(metricas.totalExtracciones, 0);
    assert.equal(metricas.totalCafeGramosConsumidos, 0);
    assert.equal(metricas.metodoMasPopular, "Ninguno");
    assert.equal(metricas.origenMasConsumido, "Ninguno");
    assert.equal(metricas.promedioPuntuacion, 0);
  });

  // 9. obtenerMetricasPlataforma: usuario no admin recibe PROHIBIDO
  it("obtenerMetricasPlataforma: usuario no admin recibe error PROHIBIDO", () => {
    crearUsuario("ana@ejemplo.com");
    assert.throws(
      () => logica.obtenerMetricasPlataforma("ana@ejemplo.com"),
      (err) => err.code === "PROHIBIDO"
    );
  });
});
