/**
 * Tests de integración HTTP — PBI-11: comunidad, moderación y métricas.
 * Verifican transporte, autenticación y autorización (roles admin vs usuario).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const Datos = require("../servidor/datos");
const Logica = require("../servidor/logica");
const { createApp } = require("../servidor/api");

async function arrancar() {
  const datos = new Datos();
  const logica = new Logica(datos, { costeHash: 4 });
  const app = createApp(logica);
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  return { server, logica, base: `http://127.0.0.1:${server.address().port}` };
}

async function llamar(base, metodo, ruta, cuerpo, token) {
  const cabeceras = { "Content-Type": "application/json" };
  if (token) {
    cabeceras.Authorization = "Bearer " + token;
  }
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: res.status, cuerpo: await res.json() };
}

async function entrarComo(base, logica, email, esAdmin = false) {
  await llamar(base, "POST", "/api/auth/registro", { email, password: "secreta123" });
  logica.activar(email);
  if (esAdmin) {
    logica.inicializarAdmin(email);
  }
  const login = await llamar(base, "POST", "/api/auth/login", { email, password: "secreta123" });
  assert.equal(login.estado, 200);
  return login.cuerpo.token;
}

describe("PBI-11: endpoints comunidad y admin (HTTP)", () => {
  // 1. 401 si no hay token de autenticación
  it("rutas devuelven 401 sin sesión", async () => {
    const { server, base } = await arrancar();
    try {
      assert.equal((await llamar(base, "GET", "/api/comunidad")).estado, 401);
      assert.equal((await llamar(base, "GET", "/api/admin/metricas")).estado, 401);
      assert.equal((await llamar(base, "POST", "/api/admin/extracciones/123/moderar", { accion: "despublicar" })).estado, 401);
    } finally {
      server.close();
    }
  });

  // 2. GET /api/comunidad devuelve 200 y respeta filtros
  it("GET /api/comunidad devuelve 200 y aplica filtros ?metodo y ?buscar", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");

      const b = await llamar(base, "POST", "/api/bolsas", { nombre: "Geisha Especial", origen: "Panamá", gramosIniciales: 250 }, tokenAna);
      const bolsaId = b.cuerpo.id;

      // Crea una pública V60
      await llamar(base, "POST", "/api/extracciones", { bolsaId, metodo: "V60", cafeGramos: 15, aguaGramos: 250, esPublica: true }, tokenAna);
      // Crea una privada Chemex
      await llamar(base, "POST", "/api/extracciones", { bolsaId, metodo: "Chemex", cafeGramos: 20, aguaGramos: 300, esPublica: false }, tokenAna);

      // Listar comunidad completa
      const res = await llamar(base, "GET", "/api/comunidad", undefined, tokenAna);
      assert.equal(res.estado, 200);
      assert.equal(res.cuerpo.length, 1);
      assert.equal(res.cuerpo[0].metodo, "V60");

      // Con filtro método coincidente
      const resMetodo = await llamar(base, "GET", "/api/comunidad?metodo=v60", undefined, tokenAna);
      assert.equal(resMetodo.cuerpo.length, 1);

      // Con filtro método no coincidente
      const resVacio = await llamar(base, "GET", "/api/comunidad?metodo=Aeropress", undefined, tokenAna);
      assert.equal(resVacio.cuerpo.length, 0);

      // Con filtro buscar coincidente
      const resBuscar = await llamar(base, "GET", "/api/comunidad?buscar=geisha", undefined, tokenAna);
      assert.equal(resBuscar.cuerpo.length, 1);
    } finally {
      server.close();
    }
  });

  // 3. GET /api/admin/metricas: 403 para usuario estándar y 200 para admin
  it("GET /api/admin/metricas: 403 para usuario estándar y 200 para admin", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenUsuario = await entrarComo(base, logica, "usuario@ejemplo.com", false);
      const tokenAdmin = await entrarComo(base, logica, "admin@ejemplo.com", true);

      // Usuario normal -> 403
      const resUsuario = await llamar(base, "GET", "/api/admin/metricas", undefined, tokenUsuario);
      assert.equal(resUsuario.estado, 403);

      // Admin -> 200
      const resAdmin = await llamar(base, "GET", "/api/admin/metricas", undefined, tokenAdmin);
      assert.equal(resAdmin.estado, 200);
      assert.equal(resAdmin.cuerpo.totalUsuarios, 2);
      assert.equal(resAdmin.cuerpo.totalBolsas, 0);
      assert.equal(resAdmin.cuerpo.metodoMasPopular, "Ninguno");
    } finally {
      server.close();
    }
  });

  // 4. POST /api/admin/extracciones/:id/moderar: 403 para usuario estándar y 200 para admin
  it("POST /api/admin/extracciones/:id/moderar: 403 para usuario estándar y 200 para admin", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenUsuario = await entrarComo(base, logica, "usuario@ejemplo.com", false);
      const tokenAdmin = await entrarComo(base, logica, "admin@ejemplo.com", true);

      const b = await llamar(base, "POST", "/api/bolsas", { nombre: "Pacamara", origen: "El Salvador", gramosIniciales: 200 }, tokenUsuario);
      const ext = await llamar(base, "POST", "/api/extracciones", { bolsaId: b.cuerpo.id, metodo: "V60", cafeGramos: 15, aguaGramos: 250, esPublica: true }, tokenUsuario);
      const extraccionId = ext.cuerpo.extraccion.id;

      // Usuario normal intenta moderar -> 403
      const modUsuario = await llamar(
        base,
        "POST",
        `/api/admin/extracciones/${extraccionId}/moderar`,
        { accion: "despublicar" },
        tokenUsuario
      );
      assert.equal(modUsuario.estado, 403);

      // Admin modera (despublicar) -> 200
      const modAdmin = await llamar(
        base,
        "POST",
        `/api/admin/extracciones/${extraccionId}/moderar`,
        { accion: "despublicar" },
        tokenAdmin
      );
      assert.equal(modAdmin.estado, 200);
      assert.equal(modAdmin.cuerpo.esPublica, false);

      // Admin modera (eliminar) -> 200
      const delAdmin = await llamar(
        base,
        "POST",
        `/api/admin/extracciones/${extraccionId}/moderar`,
        { accion: "eliminar" },
        tokenAdmin
      );
      assert.equal(delAdmin.estado, 200);
      assert.deepEqual(delAdmin.cuerpo, { eliminada: true });
    } finally {
      server.close();
    }
  });
});
