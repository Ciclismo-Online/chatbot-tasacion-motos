/* app.js
   Lógica del formulario: validación ligera, envío al backend (Cloud Run),
   render de resultados (texto y JSON estructurado), manejo de errores y utilidades.
*/

(function () {
  // ---------- Utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const fmtEUR = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  });

  const formatMoney = (v) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
    return fmtEUR.format(Number(v));
  };

  const setStatus = (msg) => {
    const el = $("#status");
    if (el) el.textContent = msg || "";
  };

  const show = (el) => el && el.removeAttribute("hidden");
  const hide = (el) => el && el.setAttribute("hidden", "");

   // Convierte claves técnicas en etiquetas legibles
function prettifyKey(k = "") {
  if (!k) return "";
  let s = String(k).trim();

  // Sufijos conocidos -> paréntesis
  const pct = s.endsWith("_pct");
  const eur = s.endsWith("_eur");
  if (pct) s = s.replace(/_pct$/, "");
  if (eur) s = s.replace(/_eur$/, "");

  // Guiones bajos -> espacios
  s = s.replace(/_/g, " ");

  // Capitaliza cada palabra
  s = s.replace(/\b\w/g, (m) => m.toUpperCase());

  // Añade sufijos legibles
  if (pct) s += " (%)";
  if (eur) s += " (EUR)";

  return s;
}

  // ---------- Obtención del endpoint ----------
  function getEndpoint() {
    // Prioridad 1: atributo data-endpoint del formulario
    const form = $("#tasacion-form");
    if (form && form.dataset.endpoint) return form.dataset.endpoint.trim();

    // Prioridad 2: <meta name="tasador-endpoint" content="...">
    const meta = document.querySelector('meta[name="tasador-endpoint"]');
    if (meta && meta.content) return meta.content.trim();

    return null;
  }

  const ENDPOINT = getEndpoint();
  if (!ENDPOINT) {
    console.error("No se encontró el endpoint del tasador.");
    alert(
      "No se ha configurado el endpoint del tasador. Revisa el meta 'tasador-endpoint' o el data-endpoint del formulario."
    );
    return;
  }

  // ---------- Elementos de la UI ----------
  const form = $("#tasacion-form");
  const btnSubmit = $("#submitBtn");
  const resultado = $("#resultado");
  const errorBox = $("#errorBox");
  const errorMessage = $("#errorMessage");
  const printBtn = $("#printBtn");
 

  const responseTextEl = $("#responseText");
  const offerCard = $("#offerCard");
  const offerValue = $("#offerValue");
  const offerNotes = $("#offerNotes");

  const resumenValWrapper = $("#resumenValWrapper");
  const resumenVal = $("#resumenVal");
  const estimacionesWrapper = $("#estimacionesWrapper");
  const estimationsBody = $("#estimationsBody");
  const supuestosWrapper = $("#supuestosWrapper");
  const supuestosList = $("#supuestosList");
  const notasWrapper = $("#notasWrapper");
  const notasList = $("#notasList");

  const copyJsonBtn = $("#copyJsonBtn");
  const copyTextBtn = $("#copyTextBtn");

  // ---------- Validación ligera ----------
  function validate(values) {
    const errs = [];

    const year = Number(values.ano);
    if (!Number.isFinite(year) || year < 1980 || year > 2099) {
      errs.push("El año debe estar entre 1980 y 2099.");
    }

    const kms = Number(values.kms);
    if (!Number.isFinite(kms) || kms < 0) {
      errs.push("Los kilómetros deben ser un número mayor o igual a 0.");
    }

    ["marca", "modelo", "version"].forEach((k) => {
      if (!values[k] || String(values[k]).trim().length === 0) {
        errs.push(`El campo ${k} es obligatorio.`);
      }
    });

    return errs;
  }

  // ---------- Render de la valoración ----------
  function renderValuation(valuation) {
    // Limpia UI
    hide(offerCard);
    hide(resumenValWrapper);
    hide(estimacionesWrapper);
    hide(supuestosWrapper);
    hide(notasWrapper);
    estimationsBody.innerHTML = "";
    supuestosList.innerHTML = "";
    notasList.innerHTML = "";

    if (!valuation || typeof valuation !== "object") return;

    // Oferta de compra (destacada)
    if (valuation.oferta_compra) {
      const ov = valuation.oferta_compra;
      const valor =
        ov.valor != null
          ? formatMoney(ov.valor)
          : ov.rango
          ? `${formatMoney(ov.rango.min)} – ${formatMoney(ov.rango.max)}`
          : "";

      if (valor) {
        offerValue.textContent = valor;
        offerNotes.textContent = ov.notas || "";
        show(offerCard);
      }
    }

    // Resumen técnico
    if (valuation.resumen) {
  // Limpiamos el contenedor
  resumenVal.innerHTML = "";

  // Si el resumen es objeto, mostramos clave → valor de forma legible
  if (typeof valuation.resumen === "object" && !Array.isArray(valuation.resumen)) {
    const ul = document.createElement("ul");
    ul.classList.add("user-friendly-list");

    for (const [key, val] of Object.entries(valuation.resumen)) {
      const li = document.createElement("li");
      const label = key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()); // capitaliza
      li.textContent = `${label}: ${val}`;
      ul.appendChild(li);
    }
    resumenVal.appendChild(ul);
  } else {
    // Si es texto simple, lo mostramos directamente
    resumenVal.textContent = String(valuation.resumen);
  }

  show(resumenValWrapper);
}

    // Estimaciones (mínimo, medio, máximo, u otras claves)
    if (valuation.estimaciones && typeof valuation.estimaciones === "object") {
      const entries = Object.entries(valuation.estimaciones);
      if (entries.length) {
        for (const [tipo, info] of entries) {
          // info puede ser número o objeto { valor, notas } o { min, max }
          let valorStr = "";
          let notas = "";

          if (typeof info === "number") {
            valorStr = formatMoney(info);
          } else if (info && typeof info === "object") {
            if ("valor" in info) valorStr = formatMoney(info.valor);
            else if ("min" in info || "max" in info) {
              const min = "min" in info ? formatMoney(info.min) : "";
              const max = "max" in info ? formatMoney(info.max) : "";
              valorStr = `${min}${min && max ? " – " : ""}${max}`;
            }
            if (info.notas) notas = String(info.notas);
          }

          const tr = document.createElement("tr");
const tdTipo = document.createElement("td");
const tdValor = document.createElement("td");
tdTipo.textContent = prettifyKey(tipo);
tdValor.textContent = valorStr || "-";
tr.appendChild(tdTipo);
tr.appendChild(tdValor);
estimationsBody.appendChild(tr);

        }
        show(estimacionesWrapper);
      }
    }

    // Supuestos
    if (Array.isArray(valuation.supuestos) && valuation.supuestos.length) {
      valuation.supuestos.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = String(s);
        supuestosList.appendChild(li);
      });
      show(supuestosWrapper);
    }

    // Notas
    if (Array.isArray(valuation.notas) && valuation.notas.length) {
      valuation.notas.forEach((n) => {
        const li = document.createElement("li");
        li.textContent = String(n);
        notasList.appendChild(li);
      });
      show(notasWrapper);
    }
  }

  // ---------- Copiado al portapapeles ----------
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Contenido copiado al portapapeles.");
    } catch {
      // Fallback muy básico
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("Contenido copiado (método alternativo).");
    }
  }

  // ---------- Envío del formulario ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(errorBox);
    show(resultado); // mantenemos visible la tarjeta de resultado

    // Recogemos valores
    const fd = new FormData(form);
    const values = Object.fromEntries(fd.entries());

    // Normaliza tipos numéricos
    values.ano = Number(values.ano || 0);
    values.kms = Number(values.kms || 0);

    // Validación
    const errs = validate(values);
    if (errs.length) {
      responseTextEl.textContent = "";
      renderValuation(null);
      show(errorBox);
      errorMessage.textContent = errs.join(" ");
       // --- Scroll automático al cuadro de error ---
setTimeout(() => {
  errorBox.scrollIntoView({ behavior: "smooth", block: "start" });
  const title = errorBox.querySelector("h2");
  if (title) title.focus();
}, 200);

      setStatus("Corrige los errores del formulario.");
      return;
    }

    // Estado de carga
    btnSubmit.disabled = true;
    setStatus("Calculando…");

    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
          // No añadimos 'Origin': el navegador la gestiona solo
        },
        body: JSON.stringify(values)
      });

      // Si el backend devuelve error HTTP
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(
          `El servicio devolvió ${resp.status}. ${txt || "Inténtalo de nuevo."}`
        );
      }

      // Parseo del JSON
      const data = await resp.json();

      if (!data || data.success !== true) {
        const msg =
          (data && (data.message || data.error)) ||
          "No se pudo completar la tasación.";
        throw new Error(msg);
      }

      // Render del texto libre
      const txt = data.responseText;
      responseTextEl.textContent =
        txt && String(txt).trim().length > 0
          ? String(txt)
          : "La valoración se generó correctamente. Consulta el detalle estructurado.";

      // Render del objeto estructurado
      renderValuation(data.valuation);

       // --- Scroll automático al resultado ---
if (resultado) {
  // Espera un pequeño retardo para asegurar que el contenido ya se pintó
  setTimeout(() => {
    resultado.scrollIntoView({ behavior: "smooth", block: "start" });
    // Foco al título para accesibilidad
    const title = resultado.querySelector("h2");
    if (title) title.focus();
  }, 200);
}

      setStatus("Listo.");
      hide(errorBox);
    } catch (err) {
      console.error(err);
      show(errorBox);
      errorMessage.textContent =
        err && err.message
          ? err.message
          : "Error desconocido al realizar la tasación.";
      setStatus("Se produjo un error.");
      // Limpiamos paneles para evitar confusión
      responseTextEl.textContent = "";
      renderValuation(null);
    } finally {
      btnSubmit.disabled = false;
    }
  });

 // --- Botón "Descargar PDF" ---
printBtn?.addEventListener("click", () => {
  window.print();
});


})();
