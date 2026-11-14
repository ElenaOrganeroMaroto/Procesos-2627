/**
 * Capa de lógica de negocio (PBI-3: registro y login locales).
 *
 * Frontera: solo conoce a Datos (inyectado por constructor).
 * NUNCA importa de api.js. Todas las reglas viven aquí; api.js
 * solo traduce los errores de dominio (err.code) a HTTP.
 *
 * Seguridad: contraseñas solo con bcrypt (hash irreversible),
 * jamás en plano ni reversibles. El hash nunca sale en vistas.
 * Sesiones: token aleatorio (randomUUID) -> email, en memoria.
 * (Persistencia tras F5, logout e invalidación: PBI-4.)
 *
 * Códigos de error de dominio:
 *   VALIDACION | DUPLICADO | ELIMINADO | NO_ENCONTRADO |
 *   CREDENCIALES | PENDIENTE | PROHIBIDO | STOCK_INSUFICIENTE
 */
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function fallo(codigo, mensaje) {
  const err = new Error(mensaje);
  err.code = codigo;
  return err;
}

class Logica {
  /**
   * @param {import('./datos')} datos capa de persistencia
   * @param {{ costeHash?: number }} opts (tests usan coste bajo)
   */
  constructor(datos, opts = {}) {
    if (!datos) {
      throw new Error("Logica requiere una instancia de Datos");
    }
    this.datos = datos;
    this.costeHash =
      Number(opts.costeHash) || Number(process.env.BCRYPT_COST) || 10;
  }

  /**
   * Estado del servicio (usado por /api/health).
   */
  getStatus() {
    return { ok: true, servicio: "procesos-2627", usuarios: this.datos.listarUsuarios().length };
  }

  normalizarEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  /**
   * Alta base (PBI-2): identidad sin credencial. El login la rechaza
   * hasta que se registre contraseña (o la active PBI-7 + registro).
   */
  alta(email, opts = {}) {
    const normalizado = this.normalizarEmail(email);
    this.comprobarDisponible(normalizado);
    const usuario = {
      email: normalizado,
      nombre: this.limpiarNombre(opts.nombre),
      rol: "usuario",
      estado: "pendiente",
      creadoEn: new Date().toISOString(),
    };
    this.datos.guardarUsuario(usuario);
    return this.vista(usuario);
  }

  /**
   * Registro local (PBI-3): alta + contraseña con hash bcrypt.
   * Crea la cuenta en "pendiente": NO puede loguearse hasta activar.
   */
  registrar(email, password, opts = {}) {
    const normalizado = this.normalizarEmail(email);
    this.comprobarDisponible(normalizado);
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      throw fallo("VALIDACION", `la contraseña necesita ${MIN_PASSWORD} caracteres mínimo`);
    }
    const usuario = {
      email: normalizado,
      nombre: this.limpiarNombre(opts.nombre),
      hash: bcrypt.hashSync(password, this.costeHash),
      rol: "usuario",
      estado: "pendiente",
      creadoEn: new Date().toISOString(),
    };
    this.datos.guardarUsuario(usuario);
    return this.vista(usuario);
  }

  /**
   * Login local (PBI-3): valida credenciales y genera la sesión.
   * No distingue "no existe" de "password mal" (no enumera usuarios).
   */
  login(email, password) {
    const normalizado = this.normalizarEmail(email);
    if (this.datos.fueEliminado(normalizado)) {
      throw fallo("ELIMINADO", "cuenta eliminada: no puede volver a entrar");
    }
    const u = this.datos.buscarPorEmail(normalizado);
    if (!u || !u.hash || !bcrypt.compareSync(String(password || ""), u.hash)) {
      throw fallo("CREDENCIALES", "credenciales inválidas");
    }
    if (u.estado !== "activo") {
      throw fallo("PENDIENTE", "cuenta pendiente de activación");
    }
    const token = randomUUID();
    this.datos.guardarSesion(token, normalizado);
    return { token, usuario: this.vista(u) };
  }

  /**
   * Revalida la sesión actual (PBI-4: persistencia tras F5).
   * Devuelve el perfil del usuario autenticado si el token es válido.
   */
  obtenerSesion(token) {
    if (!token || typeof token !== "string") {
      throw fallo("CREDENCIALES", "sesión inválida o token ausente");
    }
    const email = this.datos.buscarSesion(token);
    if (!email) {
      throw fallo("CREDENCIALES", "sesión inválida o expirada");
    }
    if (this.datos.fueEliminado(email)) {
      this.datos.eliminarSesion(token);
      throw fallo("ELIMINADO", "cuenta eliminada");
    }
    const u = this.datos.buscarPorEmail(email);
    if (!u) {
      this.datos.eliminarSesion(token);
      throw fallo("CREDENCIALES", "usuario no encontrado");
    }
    return { token, usuario: this.vista(u) };
  }

  /**
   * Cierre de sesión (PBI-4): invalida el token en el servidor.
   */
  logout(token) {
    if (token) {
      this.datos.eliminarSesion(token);
    }
    return { ok: true };
  }

  /**
   * Login externo OAuth (PBI-8): el proveedor ya verificó el email,
   * así que la cuenta nace (o queda) "activa" sin email de confirmación
   * y genera una sesión válida directamente. Respeta tumbas y roles.
   */
  loginExterno(email, nombre, proveedor) {
    const normalizado = this.normalizarEmail(email);
    if (!EMAIL_RE.test(normalizado)) {
      throw fallo("VALIDACION", "email inválido");
    }
    if (this.datos.fueEliminado(normalizado)) {
      throw fallo("ELIMINADO", "cuenta eliminada: no puede volver a entrar");
    }
    let u = this.datos.buscarPorEmail(normalizado);
    if (!u) {
      u = {
        email: normalizado,
        nombre: typeof nombre === "string" && nombre.trim() ? nombre.trim() : null,
        hash: null,
        rol: "usuario",
        estado: "activo",
        proveedor: proveedor || null,
        creadoEn: new Date().toISOString(),
      };
    } else {
      u.estado = "activo";
      if (!u.proveedor && proveedor) {
        u.proveedor = proveedor;
      }
    }
    this.datos.guardarUsuario(u);
    const token = randomUUID();
    this.datos.guardarSesion(token, normalizado);
    return { token, usuario: this.vista(u) };
  }

  /**
   * Listado: solo expone email, rol y estado (nunca hash ni internos).
   * Sin solicitante (compat PBI-2). Con roles: usar listarComo().
   */
  listar() {
    return this.datos.listarUsuarios().map((u) => ({
      email: u.email,
      rol: u.rol,
      estado: u.estado,
    }));
  }

  /**
   * Roles (PBI-6): ¿es administrador activo? Lectura fresca desde datos
   * (el rol puede haber cambiado tras emitir la sesión).
   */
  esAdmin(email) {
    const u = this.datos.buscarPorEmail(this.normalizarEmail(email));
    return !!u && u.rol === "admin" && u.estado === "activo";
  }

  /**
   * Exige rol admin al solicitante. Desconocido o sin rol -> PROHIBIDO
   * (no se distingue, para no enumerar quién existe).
   */
  exigirAdmin(solicitante) {
    if (!this.esAdmin(solicitante)) {
      throw fallo("PROHIBIDO", "requiere rol administrador");
    }
  }

  /**
   * Listado solo-admin (PBI-6). La API lo protege además con middleware.
   */
  listarComo(solicitante) {
    this.exigirAdmin(solicitante);
    return this.listar();
  }

  /**
   * Consulta de activo solo-admin (PBI-6).
   */
  consultarActivoComo(solicitante, email) {
    this.exigirAdmin(solicitante);
    return this.isActive(email);
  }

  /**
   * Borrado con reparto de permisos (PBI-6, validado en servidor):
   * admin -> cualquiera; usuario estándar -> solo su propia cuenta.
   */
  eliminarComo(solicitante, objetivo) {
    const yo = this.normalizarEmail(solicitante);
    const otro = this.normalizarEmail(objetivo);
    if (yo !== otro) {
      this.exigirAdmin(yo);
    } else if (!this.datos.buscarPorEmail(yo)) {
      throw fallo("PROHIBIDO", "requiere rol administrador");
    }
    return this.eliminar(otro);
  }

  /**
   * Seed del primer admin (PBI-6): con ADMIN_EMAIL/ADMIN_PASSWORD del
   * entorno. Si existe, lo asciende a admin activo (conserva su hash);
   * si no, lo crea activo con la contraseña dada. La justificación y
   * las variables están documentadas en README (sin secretos en código).
   */
  inicializarAdmin(email, password) {
    const normalizado = this.normalizarEmail(email);
    if (!EMAIL_RE.test(normalizado)) {
      throw fallo("VALIDACION", "email de admin inválido");
    }
    if (this.datos.fueEliminado(normalizado)) {
      throw fallo("ELIMINADO", "cuenta eliminada: no puede volver a entrar");
    }
    const existente = this.datos.buscarPorEmail(normalizado);
    if (existente) {
      existente.rol = "admin";
      existente.estado = "activo";
      this.datos.guardarUsuario(existente);
      return this.vista(existente);
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      throw fallo("VALIDACION", `la contraseña necesita ${MIN_PASSWORD} caracteres mínimo`);
    }
    const admin = {
      email: normalizado,
      nombre: null,
      hash: bcrypt.hashSync(password, this.costeHash),
      rol: "admin",
      estado: "activo",
      creadoEn: new Date().toISOString(),
    };
    this.datos.guardarUsuario(admin);
    return this.vista(admin);
  }

  /**
   * ¿Está activo? (activo = confirmado y no eliminado).
   */
  isActive(email) {
    const u = this.datos.buscarPorEmail(this.normalizarEmail(email));
    if (!u) {
      throw fallo("NO_ENCONTRADO", "usuario no encontrado");
    }
    return u.estado === "activo";
  }

  /**
   * Activación pendiente -> activo (uso interno y seed de admin).
   */
  activar(email) {
    const normalizado = this.normalizarEmail(email);
    const u = this.datos.buscarPorEmail(normalizado);
    if (!u) {
      throw fallo("NO_ENCONTRADO", "usuario no encontrado");
    }
    u.estado = "activo";
    this.datos.guardarUsuario(u);
    return this.vista(u);
  }

  /**
   * Genera el token único de verificación (PBI-7) para una cuenta
   * pendiente. La API lo convierte en enlace y lo envía por email.
   */
  solicitarVerificacion(email) {
    const normalizado = this.normalizarEmail(email);
    const u = this.datos.buscarPorEmail(normalizado);
    if (!u) {
      throw fallo("NO_ENCONTRADO", "usuario no encontrado");
    }
    if (u.estado === "activo") {
      throw fallo("VALIDACION", "la cuenta ya está activa");
    }
    const token = randomUUID();
    this.datos.guardarVerificacion(token, normalizado);
    return { email: normalizado, token };
  }

  /**
   * Canjea el enlace de activación (PBI-7): el token es de un solo
   * uso (se consume antes de activar) y lo falso/caducado da 404.
   */
  verificarCuenta(token) {
    if (!token || typeof token !== "string") {
      throw fallo("NO_ENCONTRADO", "enlace inválido o expirado");
    }
    const email = this.datos.buscarVerificacion(token);
    if (!email) {
      throw fallo("NO_ENCONTRADO", "enlace inválido o expirado");
    }
    this.datos.eliminarVerificacion(token);
    const u = this.datos.buscarPorEmail(email);
    if (!u) {
      throw fallo("NO_ENCONTRADO", "usuario no encontrado");
    }
    u.estado = "activo";
    this.datos.guardarUsuario(u);
    return this.vista(u);
  }

  /**
   * Eliminación: borra y deja tumba para que no vuelva a entrar.
   * (El reparto admin/cualquiera vs usuario/sí-mismo llega en PBI-6 con sesiones.)
   */
  eliminar(email) {
    const normalizado = this.normalizarEmail(email);
    const u = this.datos.buscarPorEmail(normalizado);
    if (!u) {
      throw fallo("NO_ENCONTRADO", "usuario no encontrado");
    }
    this.datos.eliminarUsuario(normalizado);
    this.datos.marcarEliminado(normalizado);
    return { email: normalizado, eliminado: true };
  }

  comprobarDisponible(normalizado) {
    if (!EMAIL_RE.test(normalizado)) {
      throw fallo("VALIDACION", "email inválido");
    }
    if (this.datos.fueEliminado(normalizado)) {
      throw fallo("ELIMINADO", "cuenta eliminada: no puede volver a entrar");
    }
    if (this.datos.buscarPorEmail(normalizado)) {
      throw fallo("DUPLICADO", "email ya registrado");
    }
  }

  limpiarNombre(nombre) {
    return typeof nombre === "string" && nombre.trim() ? nombre.trim() : null;
  }

  vista(u) {
    return { email: u.email, nombre: u.nombre, rol: u.rol, estado: u.estado };
  }

  // — Despensa de café (PBI-9) —

  /**
   * Crea una bolsa de café en la despensa del usuario.
   * Valida campos obligatorios y gramos > 0.
   */
  crearBolsa(usuarioEmail, datos) {
    const normalizado = this.normalizarEmail(usuarioEmail);
    if (!EMAIL_RE.test(normalizado)) {
      throw fallo("VALIDACION", "email inválido");
    }
    const nombre = typeof datos.nombre === "string" ? datos.nombre.trim() : "";
    const origen = typeof datos.origen === "string" ? datos.origen.trim() : "";
    if (!nombre || !origen) {
      throw fallo("VALIDACION", "nombre y origen son obligatorios");
    }
    const gramosIniciales = Number(datos.gramosIniciales);
    if (!gramosIniciales || gramosIniciales <= 0) {
      throw fallo("VALIDACION", "gramosIniciales debe ser un número mayor que 0");
    }
    const bolsa = {
      id: randomUUID(),
      usuarioEmail: normalizado,
      nombre,
      origen,
      tostador: (typeof datos.tostador === "string" && datos.tostador.trim()) || "Desconocido",
      variedad: (typeof datos.variedad === "string" && datos.variedad.trim()) || "Variada",
      proceso: datos.proceso || "Lavado",
      gramosIniciales,
      gramosRestantes: gramosIniciales,
      estado: "activa",
      creadaEn: new Date().toISOString(),
    };
    this.datos.guardarBolsa(bolsa);
    return bolsa;
  }

  /**
   * Lista las bolsas del usuario, ordenadas por fecha descendente.
   */
  listarBolsas(usuarioEmail) {
    const normalizado = this.normalizarEmail(usuarioEmail);
    return this.datos
      .listarBolsasPorUsuario(normalizado)
      .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
  }

  /**
   * Obtiene una bolsa por id. Solo el propietario puede verla.
   */
  obtenerBolsa(usuarioEmail, bolsaId) {
    const bolsa = this.datos.buscarBolsa(bolsaId);
    if (!bolsa) {
      throw fallo("NO_ENCONTRADO", "bolsa no encontrada");
    }
    if (bolsa.usuarioEmail !== this.normalizarEmail(usuarioEmail)) {
      throw fallo("PROHIBIDO", "no tiene permiso sobre esta bolsa");
    }
    return bolsa;
  }

  /**
   * Elimina una bolsa. El propietario o un admin pueden borrarla.
   */
  eliminarBolsa(usuarioEmail, bolsaId, opts = {}) {
    const bolsa = this.datos.buscarBolsa(bolsaId);
    if (!bolsa) {
      throw fallo("NO_ENCONTRADO", "bolsa no encontrada");
    }
    if (!opts.esAdmin && bolsa.usuarioEmail !== this.normalizarEmail(usuarioEmail)) {
      throw fallo("PROHIBIDO", "no tiene permiso sobre esta bolsa");
    }
    this.datos.eliminarBolsa(bolsaId);
    return true;
  }

  // — Diario de extracciones y cálculo de ratios (PBI-10) —

  /**
   * Registra una extracción asociada a una bolsa de café, descuenta inventario y calcula ratio.
   */
  registrarExtraccion(usuarioEmail, datos = {}) {
    const normalizado = this.normalizarEmail(usuarioEmail);
    if (!EMAIL_RE.test(normalizado)) {
      throw fallo("VALIDACION", "email inválido");
    }
    if (!datos || typeof datos !== "object") {
      throw fallo("VALIDACION", "datos de extracción inválidos");
    }
    const bolsa = this.datos.buscarBolsa(datos.bolsaId);
    if (!bolsa) {
      throw fallo("NO_ENCONTRADO", "bolsa no encontrada");
    }
    if (bolsa.usuarioEmail !== normalizado) {
      throw fallo("PROHIBIDO", "no tiene permiso sobre esta bolsa");
    }
    const cafeGramos = Number(datos.cafeGramos);
    const aguaGramos = Number(datos.aguaGramos);
    if (!cafeGramos || cafeGramos <= 0 || !aguaGramos || aguaGramos <= 0) {
      throw fallo("VALIDACION", "cafeGramos y aguaGramos deben ser mayores a 0");
    }
    if (typeof datos.metodo !== "string" || !datos.metodo.trim()) {
      throw fallo("VALIDACION", "el método es obligatorio");
    }

    // Regla de inventario
    if (bolsa.gramosRestantes < cafeGramos) {
      throw fallo("STOCK_INSUFICIENTE", "No queda suficiente café en la bolsa");
    }
    bolsa.gramosRestantes = Number((bolsa.gramosRestantes - cafeGramos).toFixed(2));
    if (bolsa.gramosRestantes <= 0) {
      bolsa.gramosRestantes = 0;
      bolsa.estado = "agotada";
    }
    this.datos.guardarBolsa(bolsa);

    // Cálculo de ratio
    const ratio = Number((aguaGramos / cafeGramos).toFixed(1));

    const extraccion = {
      id: randomUUID(),
      usuarioEmail: normalizado,
      bolsaId: datos.bolsaId,
      nombreCafe: bolsa.nombre || bolsa.origen,
      origen: bolsa.origen,
      metodo: datos.metodo.trim(),
      cafeGramos,
      aguaGramos,
      ratio,
      tiempoSegundos: Number(datos.tiempoSegundos) || 0,
      molienda: (typeof datos.molienda === "string" && datos.molienda.trim()) || "Media",
      notasSabor: (typeof datos.notasSabor === "string" && datos.notasSabor.trim()) || "",
      puntuacion: Number(datos.puntuacion) || 0,
      esPublica: Boolean(datos.esPublica),
      creadaEn: new Date().toISOString(),
    };

    this.datos.guardarExtraccion(extraccion);
    return { extraccion, bolsaActualizada: bolsa };
  }

  /**
   * Lista las extracciones del usuario ordenadas por creadaEn descendente.
   */
  listarExtracciones(usuarioEmail) {
    const normalizado = this.normalizarEmail(usuarioEmail);
    return this.datos
      .listarExtraccionesPorUsuario(normalizado)
      .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
  }

  /**
   * Obtiene una extracción por id. Si es ajena pero no pública -> PROHIBIDO.
   */
  obtenerExtraccion(usuarioEmail, extraccionId) {
    const extraccion = this.datos.buscarExtraccion(extraccionId);
    if (!extraccion) {
      throw fallo("NO_ENCONTRADO", "extracción no encontrada");
    }
    const normalizado = this.normalizarEmail(usuarioEmail);
    if (extraccion.usuarioEmail !== normalizado && !extraccion.esPublica) {
      throw fallo("PROHIBIDO", "no tiene permiso sobre esta extracción");
    }
    return extraccion;
  }

  /**
   * Elimina una extracción por id. Propietario o admin pueden borrarla.
   */
  eliminarExtraccion(usuarioEmail, extraccionId, opts = {}) {
    const extraccion = this.datos.buscarExtraccion(extraccionId);
    if (!extraccion) {
      throw fallo("NO_ENCONTRADO", "extracción no encontrada");
    }
    const normalizado = this.normalizarEmail(usuarioEmail);
    if (!opts.esAdmin && extraccion.usuarioEmail !== normalizado) {
      throw fallo("PROHIBIDO", "no tiene permiso sobre esta extracción");
    }
    this.datos.eliminarExtraccion(extraccionId);
    return true;
  }

  // — Recetas de la comunidad, moderación y métricas (PBI-11) —

  /**
   * Lista recetas públicas de la comunidad con filtros opcionales de método y búsqueda.
   */
  listarComunidad(filtros = {}) {
    let resultado = this.datos.listarExtraccionesPublicas();

    if (filtros.metodo && typeof filtros.metodo === "string") {
      const m = filtros.metodo.trim().toLowerCase();
      resultado = resultado.filter(
        (ext) => ext.metodo && ext.metodo.toLowerCase() === m
      );
    }

    if (filtros.buscar && typeof filtros.buscar === "string") {
      const b = filtros.buscar.trim().toLowerCase();
      resultado = resultado.filter(
        (ext) =>
          (ext.nombreCafe && ext.nombreCafe.toLowerCase().includes(b)) ||
          (ext.origen && ext.origen.toLowerCase().includes(b))
      );
    }

    return resultado.sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
  }

  /**
   * Modera una receta (solo admin): despublicar o eliminar.
   */
  moderarReceta(adminEmail, extraccionId, accion) {
    if (!this.esAdmin(adminEmail)) {
      throw fallo("PROHIBIDO", "requiere rol administrador");
    }
    const extraccion = this.datos.buscarExtraccion(extraccionId);
    if (!extraccion) {
      throw fallo("NO_ENCONTRADO", "extracción no encontrada");
    }

    if (accion === "despublicar") {
      extraccion.esPublica = false;
      this.datos.guardarExtraccion(extraccion);
      return extraccion;
    }

    if (accion === "eliminar") {
      this.datos.eliminarExtraccion(extraccionId);
      return { eliminada: true };
    }

    throw fallo("VALIDACION", "acción de moderación inválida");
  }

  /**
   * Obtiene estadísticas agregadas globales de la plataforma (solo admin).
   */
  obtenerMetricasPlataforma(adminEmail) {
    if (!this.esAdmin(adminEmail)) {
      throw fallo("PROHIBIDO", "requiere rol administrador");
    }

    const usuarios = this.datos.listarUsuarios();
    const totalUsuarios = usuarios.filter((u) => u.estado === "activo").length;

    const bolsas = this.datos.listarTodasBolsas();
    const totalBolsas = bolsas.length;

    const extracciones = this.datos.listarTodasExtracciones();
    const totalExtracciones = extracciones.length;

    const totalCafeGramosConsumidos = Number(
      extracciones
        .reduce((acc, e) => acc + (Number(e.cafeGramos) || 0), 0)
        .toFixed(1)
    );

    // Método más popular
    const conteoMetodos = {};
    for (const e of extracciones) {
      if (e.metodo) {
        conteoMetodos[e.metodo] = (conteoMetodos[e.metodo] || 0) + 1;
      }
    }
    let metodoMasPopular = "Ninguno";
    let maxMetodo = 0;
    for (const [m, count] of Object.entries(conteoMetodos)) {
      if (count > maxMetodo) {
        maxMetodo = count;
        metodoMasPopular = m;
      }
    }

    // Origen más consumido
    const conteoOrigenes = {};
    for (const e of extracciones) {
      if (e.origen) {
        conteoOrigenes[e.origen] = (conteoOrigenes[e.origen] || 0) + 1;
      }
    }
    let origenMasConsumido = "Ninguno";
    let maxOrigen = 0;
    for (const [o, count] of Object.entries(conteoOrigenes)) {
      if (count > maxOrigen) {
        maxOrigen = count;
        origenMasConsumido = o;
      }
    }

    // Promedio de puntuación (> 0)
    const conPuntuacion = extracciones.filter((e) => Number(e.puntuacion) > 0);
    const promedioPuntuacion = conPuntuacion.length
      ? Number(
          (
            conPuntuacion.reduce((acc, e) => acc + Number(e.puntuacion), 0) /
            conPuntuacion.length
          ).toFixed(1)
        )
      : 0;

    return {
      totalUsuarios,
      totalBolsas,
      totalExtracciones,
      totalCafeGramosConsumidos,
      metodoMasPopular,
      origenMasConsumido,
      promedioPuntuacion,
    };
  }

  /**
   * [VARIANTE-5] Decide si un actor puede eliminar a un objetivo.
   * Función pura: no accede a la base de datos. Las reglas se aplican
   * en orden:
   *  1. Un actor "usuario" solo puede eliminarse a sí mismo; si no → NO_AUTORIZADO.
   *  2. No se puede eliminar a un admin si es el último (administradores ≤ 1) → ULTIMO_ADMIN.
   *  3. En cualquier otro caso está permitido → motivo null.
   *
   * @param {{ id: string, rol: string }} actor
   * @param {{ id: string, rol: string }} objetivo
   * @param {number} administradores
   * @returns {{ permitido: boolean, motivo: string|null }}
   */
  static decidirEliminar(actor, objetivo, administradores) {
    const ROLES_VALIDOS = ["usuario", "admin"];
    if (!ROLES_VALIDOS.includes(actor.rol) || !ROLES_VALIDOS.includes(objetivo.rol)) {
      return { error: "rol desconocido" };
    }

    // Regla 1: usuario solo puede eliminarse a sí mismo.
    if (actor.rol === "usuario" && actor.id !== objetivo.id) {
      return { permitido: false, motivo: "NO_AUTORIZADO" };
    }

    // Regla 2: no se puede eliminar a un admin si es el último.
    if (objetivo.rol === "admin" && administradores <= 1) {
      return { permitido: false, motivo: "ULTIMO_ADMIN" };
    }

    // Regla 3: permitido.
    return { permitido: true, motivo: null };
  }
}

module.exports = Logica;
