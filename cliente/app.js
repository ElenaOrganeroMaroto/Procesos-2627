/**
 * GUI + Controlador del cliente BrewLab (PBI-12: Frontend Integral).
 *
 * Arquitectura:
 * - Habla con el backend EXCLUSIVAMENTE a través de `Com`.
 * - Jamás realiza llamadas `fetch` directas ni contiene lógica de persistencia.
 * - Gestiona eventos del DOM, navegación por pestañas, calculadora de ratios en vivo
 *   y renderizado reactivo de la interfaz.
 */
"use strict";

(function () {
  const Com = window.Com;
  const $ = (id) => document.getElementById(id);

  // Helper para mostrar mensajes de feedback
  function mostrarMsg(id, texto, esError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = texto || "";
    el.className = "msg " + (esError ? "msg-error" : "msg-success");
    if (!texto) {
      el.style.display = "none";
    } else {
      el.style.display = "block";
    }
  }

  // — Estado del Servidor —
  async function pintarEstado() {
    try {
      const data = await Com.health();
      $("estado").textContent = "OK (" + data.servicio + ", usuarios: " + data.usuarios + ")";
    } catch (e) {
      $("estado").textContent = "ERROR: " + e.message;
    }
  }

  // — Sistema de Pestañas —
  function configurarTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        tabBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".tab-content").forEach((panel) => {
          panel.hidden = panel.id !== targetTab;
        });

        // Refrescar contenido si es necesario al entrar en la pestaña
        if (targetTab === "tab-comunidad") {
          pintarComunidad();
        } else if (targetTab === "tab-admin") {
          pintarAdmin();
        }
      });
    });
  }

  // — Control de Sesión y Vistas —
  function pintarSesion() {
    const sesion = Com.leerSesion();
    const dentro = !!(sesion && sesion.token && sesion.usuario);
    const admin = dentro && sesion.usuario.rol === "admin";

    // Actualizar badge de usuario
    $("sesion").textContent = dentro
      ? sesion.usuario.email + " (" + sesion.usuario.rol + "/" + sesion.usuario.estado + ")"
      : "sin sesión";

    $("zona-sesion").hidden = !dentro;
    $("zona-invitado").hidden = dentro;
    $("zona-autenticado").hidden = !dentro;

    const navAdmin = $("nav-admin");
    if (navAdmin) {
      navAdmin.hidden = !admin;
    }

    if (dentro) {
      // Información de Mi Cuenta
      $("cuenta-email").textContent = sesion.usuario.email;
      $("cuenta-rol").textContent = sesion.usuario.rol;
      $("cuenta-estado").textContent = sesion.usuario.estado;

      // Cargar datos del usuario
      pintarBolsas();
      pintarExtracciones();
      pintarComunidad();

      if (admin) {
        pintarAdmin();
      }
    }
  }

  // — 1. MÓDULO: DESPENSA DE CAFÉ —
  async function pintarBolsas() {
    try {
      const bolsas = await Com.listarBolsas();
      const contenedor = $("lista-bolsas");
      const selectorExt = $("ext-bolsa");

      // Actualizar selector de extracción
      if (selectorExt) {
        selectorExt.innerHTML = '<option value="">Selecciona una bolsa de tu despensa...</option>';
      }

      if (!bolsas || bolsas.length === 0) {
        contenedor.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon">🫘</div>
            <p>Tu despensa está vacía. Añade tu primera bolsa de café arriba.</p>
          </div>
        `;
        return;
      }

      contenedor.innerHTML = "";

      bolsas.forEach((b) => {
        const inicial = Number(b.gramosIniciales) || 1;
        const restante = Number(b.gramosRestantes) || 0;
        const pct = Math.max(0, Math.min(100, Math.round((restante / inicial) * 100)));
        const esAgotada = b.estado === "agotada" || restante <= 0;

        // Añadir al selector de extracción si tiene café
        if (selectorExt && !esAgotada) {
          const opt = document.createElement("option");
          opt.value = b.id;
          opt.textContent = `${b.nombre} (${b.origen}) — ${restante}g restantes`;
          selectorExt.appendChild(opt);
        }

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(b.nombre)}</h4>
                <span class="item-subtitle">📍 ${escapeHTML(b.origen)}</span>
              </div>
              <span class="badge ${esAgotada ? "badge-depleted" : "badge-active"}">
                ${esAgotada ? "Agotada" : "Activa"}
              </span>
            </div>

            <div class="item-meta">
              <p><strong>Tostador:</strong> ${escapeHTML(b.tostador || "Desconocido")}</p>
              <p><strong>Variedad:</strong> ${escapeHTML(b.variedad || "Variada")} | <strong>Proceso:</strong> ${escapeHTML(b.proceso || "Lavado")}</p>
            </div>

            <div style="margin: 0.75rem 0;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600;">
                <span>Stock restante:</span>
                <span>${restante}g / ${inicial}g (${pct}%)</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill ${esAgotada ? "depleted" : ""}" style="width: ${pct}%;"></div>
              </div>
            </div>
          </div>

          <div class="item-footer">
            <span style="font-size: 0.8rem; color: var(--text-light);">${formatearFecha(b.creadaEn)}</span>
            <button type="button" class="btn btn-secondary btn-sm btn-borrar-bolsa" data-id="${b.id}" style="color: var(--danger);">
              🗑️ Borrar
            </button>
          </div>
        `;

        card.querySelector(".btn-borrar-bolsa").addEventListener("click", async () => {
          if (confirm(`¿Seguro que deseas eliminar la bolsa "${b.nombre}"?`)) {
            try {
              await Com.borrarBolsa(b.id);
              mostrarMsg("bolsa-msg", "Bolsa eliminada con éxito.");
              pintarBolsas();
            } catch (err) {
              mostrarMsg("bolsa-msg", "ERROR: " + err.message, true);
            }
          }
        });

        contenedor.appendChild(card);
      });
    } catch (e) {
      mostrarMsg("bolsa-msg", "ERROR al cargar bolsas: " + e.message, true);
    }
  }

  // — 2. MÓDULO: DIARIO DE EXTRACCIONES Y CALCULADORA EN VIVO —
  function configurarCalculadoraRatio() {
    const cafeInput = $("ext-cafe");
    const aguaInput = $("ext-agua");
    const ratioDisplay = $("calc-ratio-display");
    const ratioHint = $("calc-ratio-hint");

    function calcular() {
      const cafe = parseFloat(cafeInput.value);
      const agua = parseFloat(aguaInput.value);

      if (cafe > 0 && agua > 0) {
        const ratio = (agua / cafe).toFixed(1);
        ratioDisplay.textContent = "1 : " + ratio;
        ratioHint.textContent = `(${cafe}g de café para ${agua}g de agua)`;
      } else {
        ratioDisplay.textContent = "1 : --";
        ratioHint.textContent = "Introduce café y agua para calcular el ratio en tiempo real";
      }
    }

    cafeInput.addEventListener("input", calcular);
    aguaInput.addEventListener("input", calcular);
  }

  async function pintarExtracciones() {
    try {
      const extracciones = await Com.listarExtracciones();
      const contenedor = $("lista-extracciones");

      if (!extracciones || extracciones.length === 0) {
        contenedor.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon">⚖️</div>
            <p>Aún no has registrado extracciones. Prepara una receta arriba.</p>
          </div>
        `;
        return;
      }

      contenedor.innerHTML = "";

      extracciones.forEach((e) => {
        const estrellas = "⭐".repeat(Math.max(0, Math.min(5, Number(e.puntuacion) || 0)));
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(e.nombreCafe)}</h4>
                <span class="item-subtitle">📍 ${escapeHTML(e.origen)}</span>
              </div>
              <span class="badge ${e.esPublica ? "badge-public" : "badge-private"}">
                ${e.esPublica ? "🌍 Pública" : "🔒 Privada"}
              </span>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0;">
              <span class="badge badge-method">☕ ${escapeHTML(e.metodo)}</span>
              <span style="font-weight: 700; color: var(--ratio-highlight); font-size: 0.95rem;">Ratio 1:${e.ratio}</span>
            </div>

            <div class="item-meta">
              <p><strong>Dosis:</strong> ${e.cafeGramos}g café / ${e.aguaGramos}g agua</p>
              <p><strong>Molienda:</strong> ${escapeHTML(e.molienda || "Media")} ${e.tiempoSegundos ? `| <strong>Tiempo:</strong> ${e.tiempoSegundos}s` : ""}</p>
            </div>

            ${e.notasSabor ? `<div class="item-notes">“${escapeHTML(e.notasSabor)}”</div>` : ""}

            ${estrellas ? `<div class="stars" style="margin-top: 0.35rem;">${estrellas} (${e.puntuacion}/5)</div>` : ""}
          </div>

          <div class="item-footer">
            <span style="font-size: 0.8rem; color: var(--text-light);">${formatearFecha(e.creadaEn)}</span>
            <button type="button" class="btn btn-secondary btn-sm btn-borrar-extraccion" data-id="${e.id}" style="color: var(--danger);">
              🗑️ Borrar
            </button>
          </div>
        `;

        card.querySelector(".btn-borrar-extraccion").addEventListener("click", async () => {
          if (confirm("¿Deseas eliminar este registro de extracción?")) {
            try {
              await Com.borrarExtraccion(e.id);
              mostrarMsg("ext-msg", "Extracción eliminada con éxito.");
              pintarExtracciones();
            } catch (err) {
              mostrarMsg("ext-msg", "ERROR: " + err.message, true);
            }
          }
        });

        contenedor.appendChild(card);
      });
    } catch (e) {
      mostrarMsg("ext-msg", "ERROR al cargar extracciones: " + e.message, true);
    }
  }

  // — 3. MÓDULO: COMUNIDAD DE RECETAS —
  async function pintarComunidad() {
    try {
      const buscar = $("com-buscar") ? $("com-buscar").value.trim() : "";
      const metodo = $("com-metodo") ? $("com-metodo").value.trim() : "";

      const recetas = await Com.listarComunidad({ buscar, metodo });
      const contenedor = $("muro-comunidad");

      if (!recetas || recetas.length === 0) {
        contenedor.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon">🔍</div>
            <p>No se encontraron recetas públicas con los criterios seleccionados.</p>
          </div>
        `;
        return;
      }

      contenedor.innerHTML = "";

      recetas.forEach((r) => {
        const estrellas = "⭐".repeat(Math.max(0, Math.min(5, Number(r.puntuacion) || 0)));
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(r.nombreCafe)}</h4>
                <span class="item-subtitle">📍 ${escapeHTML(r.origen)}</span>
              </div>
              <span class="badge badge-method">☕ ${escapeHTML(r.metodo)}</span>
            </div>

            <div style="margin: 0.5rem 0;">
              <span style="font-size: 1.1rem; font-weight: 800; color: var(--ratio-highlight);">Ratio 1:${r.ratio}</span>
              <span style="font-size: 0.85rem; color: var(--text-muted); margin-left: 0.5rem;">(${r.cafeGramos}g café / ${r.aguaGramos}g agua)</span>
            </div>

            <div class="item-meta">
              <p><strong>Molienda:</strong> ${escapeHTML(r.molienda || "Media")} ${r.tiempoSegundos ? `| <strong>Tiempo:</strong> ${r.tiempoSegundos}s` : ""}</p>
            </div>

            ${r.notasSabor ? `<div class="item-notes">“${escapeHTML(r.notasSabor)}”</div>` : ""}

            ${estrellas ? `<div class="stars">${estrellas} (${r.puntuacion}/5)</div>` : ""}
          </div>

          <div class="item-footer">
            <span style="font-size: 0.8rem; color: var(--text-muted);">
              👤 Barista: <strong>${escapeHTML(r.usuarioEmail.split("@")[0])}</strong>
            </span>
            <span style="font-size: 0.8rem; color: var(--text-light);">${formatearFecha(r.creadaEn)}</span>
          </div>
        `;
        contenedor.appendChild(card);
      });
    } catch (e) {
      console.error("Error al cargar comunidad:", e);
    }
  }

  // — 4. MÓDULO: ADMINISTRACIÓN Y MÉTRICAS —
  async function pintarAdmin() {
    const sesion = Com.leerSesion();
    if (!sesion || !sesion.usuario || sesion.usuario.rol !== "admin") {
      return;
    }

    // 1. Pintar Métricas agregadas
    try {
      const m = await Com.obtenerMetricas();
      $("metric-cafe-consumido").textContent = (m.totalCafeGramosConsumidos || 0) + "g";
      $("metric-bolsas").textContent = m.totalBolsas || 0;
      $("metric-extracciones").textContent = m.totalExtracciones || 0;
      $("metric-usuarios").textContent = m.totalUsuarios || 0;
      $("metric-metodo-popular").textContent = m.metodoMasPopular || "-";
      $("metric-origen-popular").textContent = m.origenMasConsumido || "-";
      $("metric-promedio-puntuacion").textContent = (m.promedioPuntuacion || 0) + " ⭐";
    } catch (e) {
      console.error("Error al cargar métricas de admin:", e);
    }

    // 2. Pintar Moderación de Recetas
    try {
      const recetas = await Com.listarComunidad();
      const contenedor = $("lista-moderacion");

      if (!recetas || recetas.length === 0) {
        contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No hay recetas públicas activas para moderar.</p>';
      } else {
        contenedor.innerHTML = "";
        recetas.forEach((r) => {
          const item = document.createElement("div");
          item.className = "item-card";
          item.innerHTML = `
            <div class="item-card-header">
              <div>
                <strong>${escapeHTML(r.nombreCafe)}</strong> (${escapeHTML(r.metodo)})
                <div style="font-size: 0.8rem; color: var(--text-muted);">Por: ${escapeHTML(r.usuarioEmail)} | Ratio: 1:${r.ratio}</div>
              </div>
              <span class="badge badge-public">Pública</span>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
              <button type="button" class="btn btn-secondary btn-sm btn-despublicar">Despublicar</button>
              <button type="button" class="btn btn-danger btn-sm btn-eliminar-receta">Eliminar</button>
            </div>
          `;

          item.querySelector(".btn-despublicar").addEventListener("click", async () => {
            try {
              await Com.moderarReceta(r.id, "despublicar");
              mostrarMsg("admin-mod-msg", "Receta despublicada.");
              pintarAdmin();
              pintarComunidad();
            } catch (err) {
              mostrarMsg("admin-mod-msg", "ERROR: " + err.message, true);
            }
          });

          item.querySelector(".btn-eliminar-receta").addEventListener("click", async () => {
            if (confirm("¿Seguro que deseas eliminar esta receta permanentemente?")) {
              try {
                await Com.moderarReceta(r.id, "eliminar");
                mostrarMsg("admin-mod-msg", "Receta eliminada.");
                pintarAdmin();
                pintarComunidad();
              } catch (err) {
                mostrarMsg("admin-mod-msg", "ERROR: " + err.message, true);
              }
            }
          });

          contenedor.appendChild(item);
        });
      }
    } catch (e) {
      mostrarMsg("admin-mod-msg", "ERROR al cargar moderación: " + e.message, true);
    }

    // 3. Pintar Lista de Usuarios
    try {
      const lista = await Com.listarUsuarios();
      const ul = $("lista-usuarios");
      ul.innerHTML = "";
      lista.forEach((u) => {
        const li = document.createElement("li");
        li.className = "user-list-item";
        li.innerHTML = `
          <span>
            <strong>${escapeHTML(u.email)}</strong>
            <span class="badge ${u.rol === "admin" ? "badge-method" : "badge-depleted"}" style="margin-left: 0.5rem;">${u.rol}</span>
            <span style="font-size: 0.8rem; color: var(--text-muted);">(${u.estado})</span>
          </span>
          <button type="button" class="btn btn-danger btn-sm btn-borrar-usuario">Eliminar</button>
        `;

        li.querySelector(".btn-borrar-usuario").addEventListener("click", async () => {
          if (confirm(`¿Seguro que deseas eliminar al usuario ${u.email}?`)) {
            try {
              await Com.borrarUsuario(u.email);
              mostrarMsg("admin-msg", "Usuario eliminado: " + u.email);
              pintarAdmin();
              pintarEstado();
            } catch (err) {
              mostrarMsg("admin-msg", "ERROR: " + err.message, true);
            }
          }
        });

        ul.appendChild(li);
      });
      mostrarMsg("admin-msg", "");
    } catch (e) {
      mostrarMsg("admin-msg", "ERROR: " + e.message, true);
    }
  }

  // — Inicialización y Event Listeners —
  async function inicializar() {
    await pintarEstado();
    configurarTabs();
    configurarCalculadoraRatio();

    // Recoger token de OAuth si volvemos de GitHub (?token=...)
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error")) {
      mostrarMsg("log-msg", "ERROR con GitHub: " + params.get("oauth_error"), true);
    }
    if (params.get("token")) {
      Com.guardarSesion({
        token: params.get("token"),
        usuario: { email: params.get("email") || "", rol: "usuario", estado: "activo" },
      });
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Revalidación de sesión guardada
    if (Com.leerSesion()) {
      try {
        await Com.me();
      } catch {
        // Token inválido o expirado: pedir() ya limpió la sesión
      }
    }

    pintarSesion();
  }

  // Formulario Registro Local
  $("form-registro").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const email = $("reg-email").value;
      const pass = $("reg-pass").value;
      const nombre = $("reg-nombre").value;
      const creado = await Com.registro(email, pass, nombre);
      mostrarMsg("reg-msg", "Cuenta creada como pendiente: " + creado.email + ". Revisa tu correo para activarla.");
      $("form-registro").reset();
    } catch (e) {
      mostrarMsg("reg-msg", "ERROR: " + e.message, true);
    }
    pintarEstado();
  });

  // Formulario Login Local
  $("form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const email = $("log-email").value;
      const pass = $("log-pass").value;
      const sesion = await Com.login(email, pass);
      mostrarMsg("log-msg", "Sesión iniciada con éxito.");
      $("form-login").reset();
      pintarSesion();
    } catch (e) {
      mostrarMsg("log-msg", "ERROR: " + e.message, true);
    }
    pintarEstado();
  });

  // Botón Cerrar Sesión
  $("btn-logout").addEventListener("click", async () => {
    await Com.logout();
    mostrarMsg("log-msg", "");
    pintarSesion();
    pintarEstado();
  });

  // Formulario Añadir Bolsa
  $("form-bolsa").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const datos = {
        nombre: $("bolsa-nombre").value,
        origen: $("bolsa-origen").value,
        tostador: $("bolsa-tostador").value,
        variedad: $("bolsa-variedad").value,
        proceso: $("bolsa-proceso").value,
        gramosIniciales: Number($("bolsa-gramos").value),
      };
      await Com.crearBolsa(datos);
      mostrarMsg("bolsa-msg", "Bolsa añadida a la despensa.");
      $("form-bolsa").reset();
      pintarBolsas();
    } catch (e) {
      mostrarMsg("bolsa-msg", "ERROR: " + e.message, true);
    }
  });

  // Formulario Registrar Extracción
  $("form-extraccion").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const datos = {
        bolsaId: $("ext-bolsa").value,
        metodo: $("ext-metodo").value,
        cafeGramos: Number($("ext-cafe").value),
        aguaGramos: Number($("ext-agua").value),
        tiempoSegundos: Number($("ext-tiempo").value) || 0,
        molienda: $("ext-molienda").value,
        notasSabor: $("ext-notas").value,
        puntuacion: Number($("ext-puntuacion").value) || 0,
        esPublica: $("ext-publica").checked,
      };

      const res = await Com.crearExtraccion(datos);
      mostrarMsg("ext-msg", `Extracción registrada con éxito (Ratio 1:${res.extraccion.ratio}).`);

      // Limpiar formulario y resetear display de ratio
      $("form-extraccion").reset();
      $("calc-ratio-display").textContent = "1 : --";
      $("calc-ratio-hint").textContent = "Introduce café y agua para calcular el ratio en tiempo real";

      // Refrescar vistas afectadas
      pintarExtracciones();
      pintarBolsas(); // Para ver el descuento de gramos
      if (datos.esPublica) {
        pintarComunidad();
      }
      pintarAdmin();
    } catch (e) {
      mostrarMsg("ext-msg", "ERROR: " + e.message, true);
    }
  });

  // Filtros de Comunidad
  $("btn-com-buscar").addEventListener("click", () => {
    pintarComunidad();
  });

  $("btn-com-limpiar").addEventListener("click", () => {
    if ($("com-buscar")) $("com-buscar").value = "";
    if ($("com-metodo")) $("com-metodo").value = "";
    pintarComunidad();
  });

  // Borrar mi propia cuenta
  $("btn-borrar-cuenta").addEventListener("click", async () => {
    const sesion = Com.leerSesion();
    if (!sesion || !sesion.usuario) {
      return;
    }
    if (confirm("¿Estás seguro de que deseas eliminar tu cuenta permanentemente? Esta acción es irreversible.")) {
      try {
        await Com.borrarUsuario(sesion.usuario.email);
        Com.limpiarSesion();
        mostrarMsg("cuenta-msg", "Cuenta eliminada permanentemente.");
        pintarSesion();
        pintarEstado();
      } catch (e) {
        mostrarMsg("cuenta-msg", "ERROR: " + e.message, true);
      }
    }
  });

  // Helpers de formato y seguridad
  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatearFecha(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return iso;
    }
  }

  // Arrancar
  inicializar();
})();
