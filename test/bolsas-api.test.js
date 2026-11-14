/**
 * Tests de integración HTTP — PBI-9: endpoints /api/bolsas.
 * Verifican transporte, autenticación y traducción de errores de dominio a HTTP.
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

// Registra, activa y logea un usuario; devuelve su token.
async function entrarComo(base, logica, email) {
  await llamar(base, "POST", "/api/auth/registro", { email, password: "secreta123" });
  logica.activar(email);
  const login = await llamar(base, "POST", "/api/auth/login", { email, password: "secreta123" });
  assert.equal(login.estado, 200);
  return login.cuerpo.token;
}

describe("PBI-9: endpoints /api/bolsas", () => {
  // 1. 401 si no hay token
  it("POST/GET/DELETE devuelven 401 sin token de autenticación", async () => {
    const { server, base } = await arrancar();
    try {
      assert.equal((await llamar(base, "POST", "/api/bolsas", { nombre: "X", origen: "Y", gramosIniciales: 100 })).estado, 401);
      assert.equal((await llamar(base, "GET", "/api/bolsas")).estado, 401);
      assert.equal((await llamar(base, "GET", "/api/bolsas/abc")).estado, 401);
      assert.equal((await llamar(base, "DELETE", "/api/bolsas/abc")).estado, 401);
    } finally {
      server.close();
    }
  });

  // 2. 201 al crear una bolsa
  it("POST /api/bolsas crea una bolsa y devuelve 201 con la entidad", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      const res = await llamar(base, "POST", "/api/bolsas", {
        nombre: "Geisha La Esmeralda",
        origen: "Panamá",
        gramosIniciales: 250,
      }, token);
      assert.equal(res.estado, 201);
      assert.equal(res.cuerpo.nombre, "Geisha La Esmeralda");
      assert.equal(res.cuerpo.estado, "activa");
      assert.equal(res.cuerpo.gramosRestantes, 250);
      assert.ok(res.cuerpo.id);
    } finally {
      server.close();
    }
  });

  // 3. 200 al listar bolsas del usuario autenticado
  it("GET /api/bolsas lista solo las bolsas del usuario autenticado", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");
      const tokenBob = await entrarComo(base, logica, "bob@ejemplo.com");
      await llamar(base, "POST", "/api/bolsas", { nombre: "Bolsa Ana", origen: "Colombia", gramosIniciales: 200 }, tokenAna);
      await llamar(base, "POST", "/api/bolsas", { nombre: "Bolsa Bob", origen: "Brasil", gramosIniciales: 300 }, tokenBob);
      const listaAna = await llamar(base, "GET", "/api/bolsas", undefined, tokenAna);
      assert.equal(listaAna.estado, 200);
      assert.equal(listaAna.cuerpo.length, 1);
      assert.equal(listaAna.cuerpo[0].nombre, "Bolsa Ana");
    } finally {
      server.close();
    }
  });

  // 4. 403 al acceder a bolsa ajena
  it("GET /api/bolsas/:id devuelve 403 si la bolsa no es del usuario", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");
      const tokenBob = await entrarComo(base, logica, "bob@ejemplo.com");
      const creada = await llamar(base, "POST", "/api/bolsas", { nombre: "Bolsa Ana", origen: "Colombia", gramosIniciales: 200 }, tokenAna);
      assert.equal(creada.estado, 201);
      // Bob intenta ver la bolsa de Ana
      const res = await llamar(base, "GET", `/api/bolsas/${creada.cuerpo.id}`, undefined, tokenBob);
      assert.equal(res.estado, 403);
    } finally {
      server.close();
    }
  });

  // 5. 200 al obtener bolsa propia
  it("GET /api/bolsas/:id devuelve 200 si la bolsa es del usuario", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      const creada = await llamar(base, "POST", "/api/bolsas", { nombre: "Bolsa Mía", origen: "Kenia", gramosIniciales: 150 }, token);
      const res = await llamar(base, "GET", `/api/bolsas/${creada.cuerpo.id}`, undefined, token);
      assert.equal(res.estado, 200);
      assert.equal(res.cuerpo.nombre, "Bolsa Mía");
    } finally {
      server.close();
    }
  });

  // 6. DELETE devuelve 200 con { borrado: true } al borrar bolsa propia
  it("DELETE /api/bolsas/:id borra y devuelve 200 { borrado: true }", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      const creada = await llamar(base, "POST", "/api/bolsas", { nombre: "Borrable", origen: "Perú", gramosIniciales: 100 }, token);
      const res = await llamar(base, "DELETE", `/api/bolsas/${creada.cuerpo.id}`, undefined, token);
      assert.equal(res.estado, 200);
      assert.deepEqual(res.cuerpo, { borrado: true });
      // Ya no aparece
      const lista = await llamar(base, "GET", "/api/bolsas", undefined, token);
      assert.equal(lista.cuerpo.length, 0);
    } finally {
      server.close();
    }
  });

  // 7. 400 al crear bolsa con datos inválidos
  it("POST /api/bolsas devuelve 400 si faltan campos obligatorios", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      assert.equal((await llamar(base, "POST", "/api/bolsas", { nombre: "", origen: "X", gramosIniciales: 100 }, token)).estado, 400);
      assert.equal((await llamar(base, "POST", "/api/bolsas", { nombre: "X", origen: "Y", gramosIniciales: 0 }, token)).estado, 400);
    } finally {
      server.close();
    }
  });
});
