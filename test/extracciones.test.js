/**
 * Tests unitarios de logica.js — PBI-10: diario de extracciones y cálculo de ratios.
 * Felices + errores y reglas de inventario. Sin HTTP: solo reglas de negocio.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const Datos = require("../servidor/datos");
const Logica = require("../servidor/logica");

describe("PBI-10: diario de extracciones y ratios (lógica)", () => {
  let logica;

  beforeEach(() => {
    logica = new Logica(new Datos(), { costeHash: 4 });
  });

  // — Helpers —
  function crearUsuarioActivo(email) {
    logica.registrar(email, "secreta123");
    logica.activar(email);
  }

  function crearBolsa(email, gramos = 250, nombre = "Etiopía Yirgacheffe") {
    return logica.crearBolsa(email, {
      nombre,
      origen: "Etiopía",
      gramosIniciales: gramos,
    });
  }

  // 1. Cálculo de ratio automático exacto
  it("registrarExtraccion: calcula ratio automático exacto (aguaGramos / cafeGramos)", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = crearBolsa("ana@ejemplo.com", 250);

    const { extraccion } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsa.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      tiempoSegundos: 180,
      molienda: "Media-Fina",
      notasSabor: "Jazmín, bergamota, melocotón",
      puntuacion: 5,
    });

    assert.equal(extraccion.ratio, 16.7);
    assert.equal(extraccion.cafeGramos, 15);
    assert.equal(extraccion.aguaGramos, 250);
    assert.equal(extraccion.metodo, "V60");
    assert.equal(extraccion.nombreCafe, "Etiopía Yirgacheffe");
    assert.equal(extraccion.origen, "Etiopía");
    assert.equal(extraccion.molienda, "Media-Fina");
    assert.equal(extraccion.notasSabor, "Jazmín, bergamota, melocotón");
    assert.equal(extraccion.puntuacion, 5);
    assert.equal(extraccion.esPublica, false);
    assert.ok(extraccion.id);
    assert.ok(extraccion.creadaEn);
  });

  // 2. Descuento correcto de gramos en la bolsa
  it("registrarExtraccion: descuenta gramos restantes en la bolsa y la persiste", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = crearBolsa("ana@ejemplo.com", 250);

    const { bolsaActualizada } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsa.id,
      metodo: "Chemex",
      cafeGramos: 20,
      aguaGramos: 300,
    });

    assert.equal(bolsaActualizada.gramosRestantes, 230);
    assert.equal(bolsaActualizada.estado, "activa");

    // Comprobar persistencia fresca en datos
    const bolsaEnDatos = logica.datos.buscarBolsa(bolsa.id);
    assert.equal(bolsaEnDatos.gramosRestantes, 230);
  });

  // 3. Transición automática a "agotada" al llegar a 0g
  it("registrarExtraccion: cambia estado de bolsa a 'agotada' cuando gramosRestantes llega a 0", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = crearBolsa("ana@ejemplo.com", 18);

    const { bolsaActualizada } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsa.id,
      metodo: "Espresso",
      cafeGramos: 18,
      aguaGramos: 36,
    });

    assert.equal(bolsaActualizada.gramosRestantes, 0);
    assert.equal(bolsaActualizada.estado, "agotada");

    const bolsaEnDatos = logica.datos.buscarBolsa(bolsa.id);
    assert.equal(bolsaEnDatos.gramosRestantes, 0);
    assert.equal(bolsaEnDatos.estado, "agotada");
  });

  // 4. STOCK_INSUFICIENTE si se pide más café del disponible sin alterar la bolsa
  it("registrarExtraccion: falla con STOCK_INSUFICIENTE si cafeGramos > gramosRestantes sin modificar bolsa", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = crearBolsa("ana@ejemplo.com", 10);

    assert.throws(
      () =>
        logica.registrarExtraccion("ana@ejemplo.com", {
          bolsaId: bolsa.id,
          metodo: "Aeropress",
          cafeGramos: 15,
          aguaGramos: 200,
        }),
      (err) => err.code === "STOCK_INSUFICIENTE"
    );

    // La bolsa no debe haber cambiado
    const bolsaEnDatos = logica.datos.buscarBolsa(bolsa.id);
    assert.equal(bolsaEnDatos.gramosRestantes, 10);
    assert.equal(bolsaEnDatos.estado, "activa");
  });

  // 5. Validación de parámetros <= 0 y método ausente
  it("registrarExtraccion: falla con VALIDACION si cafeGramos o aguaGramos <= 0 o método vacío", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    const bolsa = crearBolsa("ana@ejemplo.com", 250);

    // cafeGramos <= 0
    assert.throws(
      () =>
        logica.registrarExtraccion("ana@ejemplo.com", {
          bolsaId: bolsa.id,
          metodo: "V60",
          cafeGramos: 0,
          aguaGramos: 250,
        }),
      (err) => err.code === "VALIDACION"
    );

    // aguaGramos <= 0
    assert.throws(
      () =>
        logica.registrarExtraccion("ana@ejemplo.com", {
          bolsaId: bolsa.id,
          metodo: "V60",
          cafeGramos: 15,
          aguaGramos: -10,
        }),
      (err) => err.code === "VALIDACION"
    );

    // método vacío
    assert.throws(
      () =>
        logica.registrarExtraccion("ana@ejemplo.com", {
          bolsaId: bolsa.id,
          metodo: "   ",
          cafeGramos: 15,
          aguaGramos: 250,
        }),
      (err) => err.code === "VALIDACION"
    );
  });

  // 6. Rechazo si la bolsa pertenece a otro usuario
  it("registrarExtraccion: falla con PROHIBIDO si la bolsa es de otro usuario", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsaDeAna = crearBolsa("ana@ejemplo.com", 250);

    assert.throws(
      () =>
        logica.registrarExtraccion("bob@ejemplo.com", {
          bolsaId: bolsaDeAna.id,
          metodo: "V60",
          cafeGramos: 15,
          aguaGramos: 250,
        }),
      (err) => err.code === "PROHIBIDO"
    );
  });

  // 7. Fallo si la bolsa no existe
  it("registrarExtraccion: falla con NO_ENCONTRADO si la bolsa no existe", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    assert.throws(
      () =>
        logica.registrarExtraccion("ana@ejemplo.com", {
          bolsaId: "bolsa-fantasma",
          metodo: "V60",
          cafeGramos: 15,
          aguaGramos: 250,
        }),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });

  // 8. Listar extracciones ordenadas por fecha desc y aisladas por usuario
  it("listarExtracciones: devuelve extracciones del usuario ordenadas por fecha descendente", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsaAna = crearBolsa("ana@ejemplo.com", 250);
    const bolsaBob = crearBolsa("bob@ejemplo.com", 250);

    const { extraccion: e1 } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
    });
    // Simular fecha anterior para e1
    e1.creadaEn = new Date(Date.now() - 10000).toISOString();
    logica.datos.guardarExtraccion(e1);

    const { extraccion: e2 } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "Aeropress",
      cafeGramos: 12,
      aguaGramos: 200,
    });
    logica.registrarExtraccion("bob@ejemplo.com", {
      bolsaId: bolsaBob.id,
      metodo: "Espresso",
      cafeGramos: 18,
      aguaGramos: 36,
    });

    const listaAna = logica.listarExtracciones("ana@ejemplo.com");
    assert.equal(listaAna.length, 2);
    assert.equal(listaAna[0].id, e2.id); // Más reciente primero
    assert.equal(listaAna[1].id, e1.id);
    assert.ok(listaAna.every((e) => e.usuarioEmail === "ana@ejemplo.com"));

    const listaBob = logica.listarExtracciones("bob@ejemplo.com");
    assert.equal(listaBob.length, 1);
  });

  // 9. obtenerExtraccion: propia vs ajena privada vs ajena pública
  it("obtenerExtraccion: permite ver propia o ajena pública, pero prohíbe ajena privada", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsaAna = crearBolsa("ana@ejemplo.com", 250);

    const { extraccion: privada } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
      esPublica: false,
    });

    const { extraccion: publica } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "Chemex",
      cafeGramos: 20,
      aguaGramos: 300,
      esPublica: true,
    });

    // Ana ve su propia extracción privada
    assert.equal(logica.obtenerExtraccion("ana@ejemplo.com", privada.id).id, privada.id);

    // Bob NO puede ver la extracción privada de Ana
    assert.throws(
      () => logica.obtenerExtraccion("bob@ejemplo.com", privada.id),
      (err) => err.code === "PROHIBIDO"
    );

    // Bob SÍ puede ver la extracción pública de Ana
    assert.equal(logica.obtenerExtraccion("bob@ejemplo.com", publica.id).id, publica.id);

    // Inexistente -> NO_ENCONTRADO
    assert.throws(
      () => logica.obtenerExtraccion("ana@ejemplo.com", "inexistente"),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });

  // 10. Control de borrado autor vs ajeno vs admin
  it("eliminarExtraccion: autor o admin pueden borrar, usuario ajeno no", () => {
    crearUsuarioActivo("ana@ejemplo.com");
    crearUsuarioActivo("bob@ejemplo.com");
    const bolsaAna = crearBolsa("ana@ejemplo.com", 250);

    const { extraccion: e1 } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "V60",
      cafeGramos: 15,
      aguaGramos: 250,
    });

    const { extraccion: e2 } = logica.registrarExtraccion("ana@ejemplo.com", {
      bolsaId: bolsaAna.id,
      metodo: "Espresso",
      cafeGramos: 18,
      aguaGramos: 36,
    });

    // Bob no puede borrar e1
    assert.throws(
      () => logica.eliminarExtraccion("bob@ejemplo.com", e1.id),
      (err) => err.code === "PROHIBIDO"
    );

    // Admin puede borrar e1
    assert.equal(logica.eliminarExtraccion("admin@ejemplo.com", e1.id, { esAdmin: true }), true);
    assert.throws(
      () => logica.obtenerExtraccion("ana@ejemplo.com", e1.id),
      (err) => err.code === "NO_ENCONTRADO"
    );

    // Ana puede borrar su propia extracción e2
    assert.equal(logica.eliminarExtraccion("ana@ejemplo.com", e2.id), true);
    assert.throws(
      () => logica.obtenerExtraccion("ana@ejemplo.com", e2.id),
      (err) => err.code === "NO_ENCONTRADO"
    );
  });
});
