/**
 * Tests de integración HTTP — PBI-10: endpoints /api/extracciones.
 * Verifican transporte, autenticación y traducción de errores de dominio (incluido STOCK_INSUFICIENTE -> 400).
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

describe("PBI-10: endpoints /api/extracciones", () => {
  // 1. 401 si no hay token
  it("POST/GET/DELETE devuelven 401 sin token de autenticación", async () => {
    const { server, base } = await arrancar();
    try {
      assert.equal(
        (await llamar(base, "POST", "/api/extracciones", { bolsaId: "1", metodo: "V60", cafeGramos: 15, aguaGramos: 250 })).estado,
        401
      );
      assert.equal((await llamar(base, "GET", "/api/extracciones")).estado, 401);
      assert.equal((await llamar(base, "GET", "/api/extracciones/abc")).estado, 401);
      assert.equal((await llamar(base, "DELETE", "/api/extracciones/abc")).estado, 401);
    } finally {
      server.close();
    }
  });

  // 2. 201 al registrar extracción
  it("POST /api/extracciones registra extracción y devuelve 201 con extraccion y bolsaActualizada", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      const bolsaRes = await llamar(
        base,
        "POST",
        "/api/bolsas",
        { nombre: "Gesha", origen: "Colombia", gramosIniciales: 250 },
        token
      );
      assert.equal(bolsaRes.estado, 201);
      const bolsaId = bolsaRes.cuerpo.id;

      const res = await llamar(
        base,
        "POST",
        "/api/extracciones",
        {
          bolsaId,
          metodo: "V60",
          cafeGramos: 15,
          aguaGramos: 250,
          tiempoSegundos: 180,
          molienda: "Media",
          notasSabor: "Frutal",
          puntuacion: 5,
        },
        token
      );

      assert.equal(res.estado, 201);
      assert.equal(res.cuerpo.extraccion.ratio, 16.7);
      assert.equal(res.cuerpo.extraccion.cafeGramos, 15);
      assert.equal(res.cuerpo.bolsaActualizada.gramosRestantes, 235);
      assert.equal(res.cuerpo.bolsaActualizada.estado, "activa");
    } finally {
      server.close();
    }
  });

  // 3. 400 si falta café (STOCK_INSUFICIENTE)
  it("POST /api/extracciones devuelve 400 cuando el stock es insuficiente", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const token = await entrarComo(base, logica, "ana@ejemplo.com");
      const bolsaRes = await llamar(
        base,
        "POST",
        "/api/bolsas",
        { nombre: "Bourbon", origen: "Guatemala", gramosIniciales: 10 },
        token
      );
      const bolsaId = bolsaRes.cuerpo.id;

      const res = await llamar(
        base,
        "POST",
        "/api/extracciones",
        {
          bolsaId,
          metodo: "V60",
          cafeGramos: 15,
          aguaGramos: 250,
        },
        token
      );

      assert.equal(res.estado, 400);
      assert.match(res.cuerpo.error, /suficiente café/i);
    } finally {
      server.close();
    }
  });

  // 4. 200 al listar extracciones
  it("GET /api/extracciones lista solo las extracciones del usuario autenticado", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");
      const tokenBob = await entrarComo(base, logica, "bob@ejemplo.com");

      const bAna = await llamar(base, "POST", "/api/bolsas", { nombre: "Café Ana", origen: "Etiopía", gramosIniciales: 200 }, tokenAna);
      const bBob = await llamar(base, "POST", "/api/bolsas", { nombre: "Café Bob", origen: "Kenia", gramosIniciales: 200 }, tokenBob);

      await llamar(base, "POST", "/api/extracciones", { bolsaId: bAna.cuerpo.id, metodo: "V60", cafeGramos: 15, aguaGramos: 250 }, tokenAna);
      await llamar(base, "POST", "/api/extracciones", { bolsaId: bBob.cuerpo.id, metodo: "Aeropress", cafeGramos: 12, aguaGramos: 200 }, tokenBob);

      const listaAna = await llamar(base, "GET", "/api/extracciones", undefined, tokenAna);
      assert.equal(listaAna.estado, 200);
      assert.equal(listaAna.cuerpo.length, 1);
      assert.equal(listaAna.cuerpo[0].metodo, "V60");

      const listaBob = await llamar(base, "GET", "/api/extracciones", undefined, tokenBob);
      assert.equal(listaBob.estado, 200);
      assert.equal(listaBob.cuerpo.length, 1);
      assert.equal(listaBob.cuerpo[0].metodo, "Aeropress");
    } finally {
      server.close();
    }
  });

  // 5. 403 al acceder a extracción privada ajena, 200 si es pública
  it("GET /api/extracciones/:id devuelve 403 en ajena privada y 200 si es pública", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");
      const tokenBob = await entrarComo(base, logica, "bob@ejemplo.com");

      const bAna = await llamar(base, "POST", "/api/bolsas", { nombre: "Café Ana", origen: "Etiopía", gramosIniciales: 200 }, tokenAna);

      // Ana crea una privada
      const resPriv = await llamar(
        base,
        "POST",
        "/api/extracciones",
        { bolsaId: bAna.cuerpo.id, metodo: "V60", cafeGramos: 15, aguaGramos: 250, esPublica: false },
        tokenAna
      );
      // Ana crea una pública
      const resPub = await llamar(
        base,
        "POST",
        "/api/extracciones",
        { bolsaId: bAna.cuerpo.id, metodo: "Chemex", cafeGramos: 20, aguaGramos: 300, esPublica: true },
        tokenAna
      );

      // Bob accede a la privada -> 403
      const checkPriv = await llamar(base, "GET", `/api/extracciones/${resPriv.cuerpo.extraccion.id}`, undefined, tokenBob);
      assert.equal(checkPriv.estado, 403);

      // Bob accede a la pública -> 200
      const checkPub = await llamar(base, "GET", `/api/extracciones/${resPub.cuerpo.extraccion.id}`, undefined, tokenBob);
      assert.equal(checkPub.estado, 200);
      assert.equal(checkPub.cuerpo.metodo, "Chemex");
    } finally {
      server.close();
    }
  });

  // 6. DELETE /api/extracciones/:id borra (200) y rechaza a usuario ajeno (403)
  it("DELETE /api/extracciones/:id borra extracción propia (200) y rechaza a otro usuario (403)", async () => {
    const { server, logica, base } = await arrancar();
    try {
      const tokenAna = await entrarComo(base, logica, "ana@ejemplo.com");
      const tokenBob = await entrarComo(base, logica, "bob@ejemplo.com");

      const bAna = await llamar(base, "POST", "/api/bolsas", { nombre: "Café Ana", origen: "Etiopía", gramosIniciales: 200 }, tokenAna);
      const resExt = await llamar(
        base,
        "POST",
        "/api/extracciones",
        { bolsaId: bAna.cuerpo.id, metodo: "V60", cafeGramos: 15, aguaGramos: 250 },
        tokenAna
      );
      const id = resExt.cuerpo.extraccion.id;

      // Bob intenta borrar -> 403
      const delBob = await llamar(base, "DELETE", `/api/extracciones/${id}`, undefined, tokenBob);
      assert.equal(delBob.estado, 403);

      // Ana borra -> 200
      const delAna = await llamar(base, "DELETE", `/api/extracciones/${id}`, undefined, tokenAna);
      assert.equal(delAna.estado, 200);
      assert.deepEqual(delAna.cuerpo, { borrado: true });

      // Ya no existe -> 404
      const check = await llamar(base, "GET", `/api/extracciones/${id}`, undefined, tokenAna);
      assert.equal(check.estado, 404);
    } finally {
      server.close();
    }
  });
});
