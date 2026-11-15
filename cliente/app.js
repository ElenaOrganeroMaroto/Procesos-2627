/**
 * GUI + Controlador del cliente BrewLab (Rediseño Luxury Dark Espresso).
 *
 * Arquitectura:
 * - Habla con el backend EXCLUSIVAMENTE a través de `Com`.
 * - Jamás realiza llamadas `fetch` directas ni contiene lógica de persistencia.
 * - Gestiona eventos del DOM, navegación flotante por pestañas, filtros pill,
 *   calculadora de ratios en vivo y renderizado reactivo de la interfaz.
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
      $("estado").textContent = "Activo (" + data.servicio + ", usuarios: " + data.usuarios + ")";
    } catch (e) {
      $("estado").textContent = "Sin conexión: " + e.message;
    }
  }

  // — Sistema de Pestañas Flotantes —
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

  // — Filtros tipo Píldora para Métodos —
  function configurarPillsMetodos() {
    const pills = document.querySelectorAll("#pills-metodos-comunidad .pill-btn");
    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");

        const metodo = pill.getAttribute("data-metodo") || "";
        const select = $("com-metodo");
        if (select) {
          select.value = metodo;
        }
        pintarComunidad();
      });
    });
  }

  // — Control de Sesión y Vistas —
  function pintarSesion() {
    const sesion = Com.leerSesion();
    const dentro = !!(sesion && sesion.token && sesion.usuario);
    const admin = dentro && sesion.usuario.rol === "admin";

    // Actualizar badge de usuario en la cabecera
    const sesionEl = $("sesion");
    const avatarEl = document.querySelector(".avatar-circle");
    if (dentro) {
      const inicial = (sesion.usuario.email || "B").charAt(0).toUpperCase();
      if (avatarEl) avatarEl.textContent = inicial;
      sesionEl.textContent = `${sesion.usuario.email} (${sesion.usuario.rol})`;
    } else {
      if (avatarEl) avatarEl.textContent = "B";
      sesionEl.textContent = "sin sesión";
    }

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
            <div class="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                <line x1="6" y1="1" x2="6" y2="4"></line>
                <line x1="10" y1="1" x2="10" y2="4"></line>
                <line x1="14" y1="1" x2="14" y2="4"></line>
              </svg>
            </div>
            <p>Tu despensa está vacía. Añade tu primera bolsa de café para comenzar.</p>
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
          opt.textContent = `${b.nombre} (${b.origen}) — ${restante}g disponibles`;
          selectorExt.appendChild(opt);
        }

        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(b.nombre)}</h4>
                <span class="item-subtitle">${escapeHTML(b.origen)}</span>
              </div>
              <span class="badge ${esAgotada ? "badge-depleted" : "badge-active"}">
                ${esAgotada ? "Agotada" : "En despensa"}
              </span>
            </div>

            <div class="item-meta">
              <p><strong>Tostador:</strong> ${escapeHTML(b.tostador || "Desconocido")}</p>
              <p><strong>Variedad:</strong> ${escapeHTML(b.variedad || "Variada")} · <strong>Proceso:</strong> ${escapeHTML(b.proceso || "Lavado")}</p>
            </div>

            <div style="margin: 0.85rem 0 0.5rem 0;">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 600;">
                <span style="color: var(--text-muted);">Stock disponible</span>
                <span style="color: var(--accent);">${restante}g / ${inicial}g (${pct}%)</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill ${esAgotada ? "depleted" : ""}" style="width: ${pct}%;"></div>
              </div>
            </div>
          </div>

          <div class="item-footer">
            <span style="font-size: 0.78rem; color: var(--text-muted);">${formatearFecha(b.creadaEn)}</span>
            <button type="button" class="btn btn-danger btn-sm btn-borrar-bolsa" data-id="${b.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Borrar
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
        ratioHint.textContent = `${cafe}g de café molido para ${agua}g de agua vertida`;
      } else {
        ratioDisplay.textContent = "1 : --";
        ratioHint.textContent = "Introduce gramos de café y agua para calcular en tiempo real";
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
            <div class="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 3v18"></path>
                <path d="M6 8l6-3 6 3"></path>
                <path d="M6 8l-4 7h8l-4-7z"></path>
                <path d="M18 8l-4 7h8l-4-7z"></path>
                <path d="M4 21h16"></path>
              </svg>
            </div>
            <p>Aún no has registrado extracciones. Prepara una receta arriba.</p>
          </div>
        `;
        return;
      }

      contenedor.innerHTML = "";

      extracciones.forEach((e) => {
        const puntuacionNum = Number(e.puntuacion) || 0;
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(e.nombreCafe)}</h4>
                <span class="item-subtitle">${escapeHTML(e.origen)}</span>
              </div>
              <div style="display: flex; gap: 0.4rem; align-items: center;">
                ${puntuacionNum > 0 ? `<span class="badge-rating">★ ${puntuacionNum}.0</span>` : ""}
                <span class="badge ${e.esPublica ? "badge-public" : "badge-private"}">
                  ${e.esPublica ? "Pública" : "Privada"}
                </span>
              </div>
            </div>

            <div style="display: flex; gap: 0.6rem; align-items: center; margin: 0.75rem 0;">
              <span class="badge badge-method">${escapeHTML(e.metodo)}</span>
              <span style="font-family: var(--font-serif); font-size: 1.15rem; font-weight: 700; color: var(--accent);">
                Ratio 1:${e.ratio}
              </span>
            </div>

            <div class="item-meta">
              <p><strong>Dosis:</strong> ${e.cafeGramos}g café / ${e.aguaGramos}g agua</p>
              <p><strong>Molienda:</strong> ${escapeHTML(e.molienda || "Media")} ${e.tiempoSegundos ? `· <strong>Tiempo:</strong> ${e.tiempoSegundos}s` : ""}</p>
            </div>

            ${e.notasSabor ? `<div class="item-notes">“${escapeHTML(e.notasSabor)}”</div>` : ""}
          </div>

          <div class="item-footer">
            <span style="font-size: 0.78rem; color: var(--text-muted);">${formatearFecha(e.creadaEn)}</span>
            <button type="button" class="btn btn-danger btn-sm btn-borrar-extraccion" data-id="${e.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Borrar
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
            <div class="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <p>No se encontraron recetas públicas con los criterios seleccionados.</p>
          </div>
        `;
        return;
      }

      contenedor.innerHTML = "";

      recetas.forEach((r) => {
        const puntuacionNum = Number(r.puntuacion) || 0;
        const card = document.createElement("div");
        card.className = "item-card";
        card.innerHTML = `
          <div>
            <div class="item-card-header">
              <div>
                <h4 class="item-title">${escapeHTML(r.nombreCafe)}</h4>
                <span class="item-subtitle">${escapeHTML(r.origen)}</span>
              </div>
              <div style="display: flex; gap: 0.4rem; align-items: center;">
                ${puntuacionNum > 0 ? `<span class="badge-rating">★ ${puntuacionNum}.0</span>` : ""}
                <span class="badge badge-method">${escapeHTML(r.metodo)}</span>
              </div>
            </div>

            <div style="margin: 0.75rem 0 0.5rem 0;">
              <span style="font-family: var(--font-serif); font-size: 1.35rem; font-weight: 700; color: var(--accent);">
                Ratio 1:${r.ratio}
              </span>
              <span style="font-size: 0.85rem; color: var(--text-muted); margin-left: 0.5rem;">
                (${r.cafeGramos}g café / ${r.aguaGramos}g agua)
              </span>
            </div>

            <div class="item-meta">
              <p><strong>Molienda:</strong> ${escapeHTML(r.molienda || "Media")} ${r.tiempoSegundos ? `· <strong>Tiempo:</strong> ${r.tiempoSegundos}s` : ""}</p>
            </div>

            ${r.notasSabor ? `<div class="item-notes">“${escapeHTML(r.notasSabor)}”</div>` : ""}
          </div>

          <div class="item-footer">
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              Barista: <strong style="color: var(--text-main);">${escapeHTML(r.usuarioEmail.split("@")[0])}</strong>
            </span>
            <span style="font-size: 0.78rem; color: var(--text-muted);">${formatearFecha(r.creadaEn)}</span>
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
      $("metric-promedio-puntuacion").textContent = (m.promedioPuntuacion || 0) + " ★";
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
            <div>
              <div class="item-card-header">
                <div>
                  <h4 class="item-title" style="font-size: 1.1rem;">${escapeHTML(r.nombreCafe)}</h4>
                  <span class="item-subtitle">${escapeHTML(r.metodo)} · Ratio 1:${r.ratio}</span>
                </div>
                <span class="badge badge-public">Pública</span>
              </div>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                Autor: <strong>${escapeHTML(r.usuarioEmail)}</strong>
              </p>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
              <button type="button" class="btn btn-secondary btn-sm btn-despublicar">Despublicar</button>
              <button type="button" class="btn btn-danger btn-sm btn-eliminar-receta">Eliminar</button>
            </div>
          `;

          item.querySelector(".btn-despublicar").addEventListener("click", async () => {
            try {
              await Com.moderarReceta(r.id, "despublicar");
              mostrarMsg("admin-mod-msg", "Receta despublicada con éxito.");
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
                mostrarMsg("admin-mod-msg", "Receta eliminada de la plataforma.");
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
            <strong style="color: var(--text-title);">${escapeHTML(u.email)}</strong>
            <span class="badge ${u.rol === "admin" ? "badge-public" : "badge-depleted"}" style="margin-left: 0.5rem;">${u.rol}</span>
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
    configurarPillsMetodos();
    configurarCalculadoraRatio();

    // Recoger token de OAuth si volvemos de GitHub (?token=...)
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error")) {
      mostrarMsg("log-msg", "Error de autenticación con GitHub: " + params.get("oauth_error"), true);
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
      mostrarMsg("bolsa-msg", "Bolsa añadida a tu despensa.");
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
      $("calc-ratio-hint").textContent = "Introduce gramos de café y agua para calcular en tiempo real";

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
    const pills = document.querySelectorAll("#pills-metodos-comunidad .pill-btn");
    pills.forEach((p, idx) => {
      p.classList.toggle("active", idx === 0);
    });
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
