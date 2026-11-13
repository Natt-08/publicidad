
 // FESTIVAL AI
// Supabase + pgvector + Gemini + Groq + OpenRouter
// Las claves API deben estar configuradas en Vercel.

export const config = {
  maxDuration: 60
};

// ==========================================
// MODELOS DE INTELIGENCIA ARTIFICIAL
// ==========================================

const MODELOS_GEMINI = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash"
];

const MODELOS_GROQ = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b"
];

// Caché temporal del catálogo gratuito.
let cacheCatalogoOpenRouter = {
  expira: 0,
  modelos: []
};

// ==========================================
// FUNCIONES GENERALES
// ==========================================

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function fetchConTimeout(
  url,
  opciones = {},
  ms = 10000
) {
  const controller = new AbortController();

  const temporizador = setTimeout(
    () => controller.abort(),
    ms
  );

  try {
    return await fetch(url, {
      ...opciones,
      signal: controller.signal
    });
  } finally {
    clearTimeout(temporizador);
  }
}

// ==========================================
// 1. CONEXION CON SUPABASE
// ==========================================

function configurarSupabase() {
  const url = (
    process.env.SUPABASE_URL || ""
  ).replace(/\/$/, "");

  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en Vercel."
    );
  }

  return {
    url,
    headers: {
      apikey: key,
      ...(
        key.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${key}` }
      )
    }
  };
}

// ==========================================
// 2. RECUPERAR CAMPAÑAS
// ==========================================

async function obtenerCampanas() {
  const { url, headers } = configurarSupabase();

  const columnas = [
    "id",
    "titulo",
    "marca",
    "festival",
    "anio",
    "categorias",
    "metales",
    "agencia",
    "analisis_board",
    "board_image"
  ].join(",");

  const acumuladas = [];

  for (
    let inicio = 0;
    inicio < 100000;
    inicio += 500
  ) {
    const parametros = new URLSearchParams({
      select: columnas,
      order: "id.asc"
    });

    const respuesta = await fetchConTimeout(
      `${url}/rest/v1/campanas?${parametros}`,
      {
        method: "GET",
        headers: {
          ...headers,
          Range: `${inicio}-${inicio + 499}`
        }
      },
      12000
    );

    if (!respuesta.ok) {
      throw new Error(
        `Error de Supabase (${respuesta.status}): ` +
        (await respuesta.text()).slice(0, 220)
      );
    }

    const pagina = await respuesta.json();

    if (!Array.isArray(pagina)) {
      throw new Error(
        "Supabase devolvió datos inválidos."
      );
    }

    acumuladas.push(...pagina);

    if (pagina.length < 500) {
      break;
    }
  }

  if (!acumuladas.length) {
    throw new Error(
      "Supabase devolvió 0 campañas. " +
      "Revisa el proyecto, la clave y los permisos."
    );
  }

  console.log(
    "Festival AI - Campañas recuperadas:",
    acumuladas.length
  );

  return acumuladas;
}

// ==========================================
// 3. BUSQUEDA TRADICIONAL
// ==========================================

function palabrasClave(pregunta) {
  const comunes = new Set(
    [
      "que", "cual", "cuales", "como", "para",
      "por", "con", "los", "las", "una", "uno",
      "sus", "del", "de", "la", "el", "en",
      "un", "al", "y", "o", "se", "es",
      "son", "fue", "donde", "cuando", "dame",
      "busca", "campanas", "campana", "ejemplos",
      "sobre", "entre", "quiero", "hay", "mas",
      "me", "puedes", "analiza", "explicame",
      "explicar", "ideas", "casos"
    ]
  );

  return [
    ...new Set(
      normalizar(pregunta)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(
          p => p.length > 3 && !comunes.has(p)
        )
    )
  ].slice(0, 18);
}

function buscarTexto(campanas, pregunta) {
  const tokens = palabrasClave(pregunta);
  const normal = normalizar(pregunta);
  const expansiones = [];

  if (/particip|interactiv|experien/.test(normal)) {
    expansiones.push(
      "participation",
      "interactive",
      "experiential",
      "engagement",
      "activacion"
    );
  }

  if (/videojueg|gamif|gaming/.test(normal)) {
    expansiones.push(
      "game",
      "gaming",
      "gamification",
      "twitch"
    );
  }

  const hallazgos = campanas
    .map(c => {
      const titulo = normalizar(c.titulo);
      const marca = normalizar(c.marca);
      const agencia = normalizar(c.agencia);
      const board = normalizar(c.analisis_board);
      const categorias = normalizar(c.categorias);
      const metales = normalizar(c.metales);
      const festival = normalizar(c.festival);

      let puntaje = 0;

      for (const t of tokens) {
        if (titulo.includes(t)) puntaje += 100;
        if (marca.includes(t)) puntaje += 85;
        if (agencia.includes(t)) puntaje += 45;
        if (categorias.includes(t)) puntaje += 40;
        if (board.includes(t)) puntaje += 25;
      }

      for (const t of expansiones) {
        if (titulo.includes(t)) puntaje += 65;
        if (board.includes(t)) puntaje += 35;
      }

      if (
        String(c.anio) &&
        normal.includes(String(c.anio))
      ) {
        puntaje += 80;
      }

      for (const f of [
        "cannes",
        "eurobest",
        "dubai lynx"
      ]) {
        if (
          normal.includes(f) &&
          festival.includes(f)
        ) {
          puntaje += 75;
        }
      }

      for (const m of [
        "grand prix",
        "gold",
        "silver",
        "bronze"
      ]) {
        if (
          normal.includes(m) &&
          metales.includes(m)
        ) {
          puntaje += 75;
        }
      }

      return {
        campana: c,
        puntaje
      };
    })
    .filter(x => x.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje);

  return {
    total: hallazgos.length,
    registros: hallazgos
      .slice(0, 10)
      .map(x => x.campana)
  };
}

// ==========================================
// 4. BUSQUEDA SEMANTICA CON PGVECTOR
// ==========================================

async function buscarSemanticas(pregunta) {
  const clave = process.env.GEMINI_API_KEY;

  if (!clave) {
    throw new Error(
      "Falta GEMINI_API_KEY para embeddings."
    );
  }

  const { url, headers } = configurarSupabase();

  const respuestaEmbedding = await fetchConTimeout(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": clave
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: {
          parts: [{
            text: pregunta.slice(0, 3000)
          }]
        },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768
      })
    },
    12000
  );

  const datosEmbedding =
    await respuestaEmbedding.json();

  if (!respuestaEmbedding.ok) {
    throw new Error(
      `Embedding ${respuestaEmbedding.status}: ` +
      (datosEmbedding.error?.message || "")
    );
  }

  const vector =
    datosEmbedding.embedding?.values;

  if (
    !Array.isArray(vector) ||
    vector.length !== 768
  ) {
    throw new Error(
      "Embedding de consulta inválido."
    );
  }

  const norma = Math.sqrt(
    vector.reduce(
      (suma, valor) => suma + valor * valor,
      0
    )
  );

  if (!norma) {
    throw new Error("Embedding vacío.");
  }

  const normalizado = vector.map(
    valor => valor / norma
  );

  const respuestaRPC = await fetchConTimeout(
    `${url}/rest/v1/rpc/buscar_campanas_semanticas`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query_embedding: JSON.stringify(
          normalizado
        ),
        cantidad: 15
      })
    },
    12000
  );

  const resultados = await respuestaRPC.json();

  if (!respuestaRPC.ok) {
    throw new Error(
      `pgvector ${respuestaRPC.status}: ` +
      (resultados.message || "Error RPC")
    );
  }

  if (!Array.isArray(resultados)) {
    throw new Error(
      "Respuesta RPC inválida."
    );
  }

  return resultados;
}

// ==========================================
// 5. CONTEXTO DOCUMENTADO
// ==========================================

function construirContexto(campanas) {
  return campanas.map((c, i) => {
    const board = String(
      c.analisis_board || ""
    )
      .replace(/\s+/g, " ")
      .slice(
        0,
        i < 3 ? 1100 : 650
      );

    return [
      `CASO ${i + 1} | ID ${c.id}`,
      `TITULO: ${c.titulo || "No registrado"}`,
      `MARCA: ${c.marca || "No registrada"}`,
      `FESTIVAL/AÑO: ${c.festival || "Sin dato"} / ${c.anio || "Sin dato"}`,
      `AGENCIA: ${c.agencia || "No registrada"}`,
      `CATEGORIAS: ${String(c.categorias || "Sin dato").slice(0, 180)}`,
      `PREMIOS: ${String(c.metales || "Sin dato").slice(0, 180)}`,
      `ANALISIS DOCUMENTADO: ${board || "No disponible"}`,
      `BOARD: ${c.board_image || "No disponible"}`
    ].join("\n");
  }).join("\n\n---\n\n");
}

// ==========================================
// 6. MANEJO DE ERRORES
// ==========================================

function esErrorAutenticacion(status) {
  return status === 401 || status === 403;
}

// ==========================================
// 7. GEMINI CON MODELOS ALTERNATIVOS
// ==========================================

async function llamarGemini(
  prompt,
  mensaje,
  historial
) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error("Falta GEMINI_API_KEY");
  }

  const errores = [];

  for (const modelo of MODELOS_GEMINI) {
    try {
      const respuesta = await fetchConTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key
          },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [{
                text:
                  `${prompt}\n\n` +
                  `HISTORIAL RECIENTE:\n${historial}\n\n` +
                  `PREGUNTA:\n${mensaje}`
              }]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1300
            }
          })
        },
        8500
      );

      const data = await respuesta.json();

      if (!respuesta.ok) {
        console.warn(
          "Gemini",
          modelo,
          respuesta.status,
          String(
            data.error?.message || ""
          ).slice(0, 180)
        );

        errores.push(
          `${modelo}: ${respuesta.status}`
        );

        if (
          esErrorAutenticacion(
            respuesta.status
          )
        ) {
          break;
        }

        continue;
      }

      const texto = data.candidates?.[0]
        ?.content?.parts
        ?.map(p => p.text || "")
        .join("")
        .trim();

      if (texto) {
        return {
          respuesta: texto,
          modelo,
          proveedor: "gemini"
        };
      }

      errores.push(
        `${modelo}: respuesta vacía`
      );

    } catch (error) {
      errores.push(
        `${modelo}: ${error.name || "error"}`
      );
    }
  }

  throw new Error(
    `Gemini sin respuesta (${errores.join("; ")})`
  );
}

// ==========================================
// 8. GROQ Y OPENROUTER
// ==========================================

async function llamarChatCompatible(
  endpoint,
  key,
  modelos,
  prompt,
  mensaje,
  historial,
  proveedor
) {
  if (!key?.trim()) {
    throw new Error(
      proveedor === "groq"
        ? "Falta GROQ_API_KEY en Vercel"
        : "Falta OPENROUTER_API_KEY en Vercel"
    );
  }

  const mensajes = [
    {
      role: "system",
      content: prompt
    },
    ...(
      historial
        ? [{
            role: "user",
            content:
              `Contexto reciente: ${historial}`
          }]
        : []
    ),
    {
      role: "user",
      content: mensaje
    }
  ];

  const errores = [];

  for (const modelo of modelos) {
    try {
      const respuesta = await fetchConTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${key.trim()}`,
            ...(
              proveedor === "openrouter"
                ? {
                    "HTTP-Referer":
                      "https://festival-ai.vercel.app",
                    "X-OpenRouter-Title":
                      "Festival AI"
                  }
                : {}
            )
          },
          body: JSON.stringify({
            model: modelo,
            messages: mensajes,
            temperature: 0.2,
            max_tokens: 1100,
            stream: false
          })
        },
        10000
      );

      const data = await respuesta.json();

      if (!respuesta.ok) {
        const detalle = String(
          data.error?.message ||
          JSON.stringify(data)
        ).slice(0, 250);

        console.warn(
          proveedor,
          modelo,
          respuesta.status,
          detalle
        );

        errores.push(
          `${modelo}: HTTP ${respuesta.status} ${detalle}`
        );

        if (
          esErrorAutenticacion(
            respuesta.status
          )
        ) {
          break;
        }

        continue;
      }

      const salida =
        data.choices?.[0]?.message?.content;

      const texto =
        typeof salida === "string"
          ? salida.trim()
          : Array.isArray(salida)
            ? salida
                .map(x => x?.text || "")
                .join("")
                .trim()
            : "";

      if (texto) {
        return {
          respuesta: texto,
          modelo: data.model || modelo,
          proveedor
        };
      }

      errores.push(
        `${modelo}: respuesta vacía`
      );

    } catch (error) {
      errores.push(
        `${modelo}: ${error.name || "error"}`
      );
    }
  }

  throw new Error(
    `${proveedor} sin respuesta (${errores.join("; ")})`
  );
}

// ==========================================
// 9. OPENROUTER AUTOMATICO
// ==========================================

// Consulta modelos gratuitos que existen
// actualmente en OpenRouter.
// La lista se actualiza cada 30 minutos.

async function descubrirModelosOpenRouter() {
  if (
    cacheCatalogoOpenRouter.expira > Date.now()
  ) {
    return cacheCatalogoOpenRouter.modelos;
  }

  const respuesta = await fetchConTimeout(
    "https://openrouter.ai/api/v1/models?output_modalities=text",
    {},
    6000
  );

  if (!respuesta.ok) {
    throw new Error(
      "No se pudo consultar el catálogo de OpenRouter: " +
      respuesta.status
    );
  }

  const datos = await respuesta.json();

  const modelos = (
    Array.isArray(datos.data)
      ? datos.data
      : []
  )
    .filter(m =>
      typeof m.id === "string" &&
      m.id.endsWith(":free") &&
      Number(m.pricing?.prompt) === 0 &&
      Number(m.pricing?.completion) === 0 &&
      (m.context_length || 0) >= 8192 &&
      (
        !m.architecture?.output_modalities ||
        m.architecture.output_modalities.includes(
          "text"
        )
      )
    )
    .sort((a, b) => {
      const prioridad = id => {
        if (/gemma-4-31b/i.test(id)) {
          return 100;
        }

        if (/gemma-4-26b/i.test(id)) {
          return 95;
        }

        if (/nemotron-3-ultra/i.test(id)) {
          return 90;
        }

        if (/nemotron-3.5-lightning/i.test(id)) {
          return 80;
        }

        return 0;
      };

      return (
        prioridad(b.id) -
        prioridad(a.id) ||
        (b.context_length || 0) -
        (a.context_length || 0)
      );
    })
    .map(m => m.id)
    .slice(0, 4);

  cacheCatalogoOpenRouter = {
    modelos,
    expira:
      Date.now() + 30 * 60 * 1000
  };

  return modelos;
}

async function llamarOpenRouter(
  prompt,
  mensaje,
  historial
) {
  const key =
    process.env.OPENROUTER_API_KEY;

  if (!key?.trim()) {
    throw new Error(
      "Falta OPENROUTER_API_KEY en Vercel."
    );
  }

  const endpoint =
    "https://openrouter.ai/api/v1/chat/completions";

  // Intento 1: selección gratuita automática.
  try {
    return await llamarChatCompatible(
      endpoint,
      key,
      ["openrouter/free"],
      prompt,
      mensaje,
      historial,
      "openrouter"
    );

  } catch (errorPrimario) {
    // Si la clave es inválida, otro
    // modelo no solucionará el problema.
    if (
      /HTTP 401|HTTP 403/.test(
        errorPrimario.message
      )
    ) {
      throw errorPrimario;
    }

    console.warn(
      "OpenRouter automático:",
      errorPrimario.message.slice(0, 300)
    );
  }

  // Intento 2: obtener modelos gratuitos
  // directamente del catálogo actualizado.
  const modelos =
    await descubrirModelosOpenRouter();

  if (!modelos.length) {
    throw new Error(
      "No hay modelos gratuitos apropiados " +
      "en el catálogo actual de OpenRouter."
    );
  }

  return llamarChatCompatible(
    endpoint,
    key,
    modelos,
    prompt,
    mensaje,
    historial,
    "openrouter"
  );
}

// ==========================================
// 10. FUNCION PRINCIPAL DE VERCEL
// ==========================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
    });
  }

  const {
    mensaje,
    historial = []
  } = req.body || {};

  if (
    typeof mensaje !== "string" ||
    !mensaje.trim()
  ) {
    return res.status(400).json({
      error: "Escribe una consulta válida."
    });
  }

  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.OPENROUTER_API_KEY
  ) {
    return res.status(500).json({
      error:
        "No hay proveedores de IA configurados."
    });
  }

  try {
    // ======================================
    // RECUPERAR CAMPAÑAS
    // ======================================

    const campanas = await obtenerCampanas();

    console.log(
      "Festival AI - Total:",
      campanas.length
    );

    const pregunta = normalizar(mensaje);

    // ======================================
    // CONSULTAS DE CONTEO
    // ======================================

    if (
      /cuantas campanas|cuantos registros|total de campanas/.test(
        pregunta
      ) &&
      !/marca|festival|agencia|categoria|premio|ano/.test(
        pregunta
      )
    ) {
      return res.status(200).json({
        respuesta:
          `Actualmente tengo **${campanas.length.toLocaleString("es-PE")} campañas publicitarias** registradas en Supabase.`,
        registrosTotales: campanas.length,
        busquedaSemantica: "no necesaria",
        casosAnalizados: 0
      });
    }

    // ======================================
    // HISTORIAL
    // ======================================

    const historialSeguro =
      Array.isArray(historial)
        ? historial
            .slice(-4)
            .filter(m =>
              ["user", "assistant"].includes(
                m.role
              ) &&
              typeof m.content === "string"
            )
        : [];

    const resumenHistorial = historialSeguro
      .map(m =>
        `${m.role}: ${m.content.slice(0, 300)}`
      )
      .join("\n")
      .slice(0, 1000);

    // ======================================
    // BUSQUEDA HIBRIDA
    // ======================================

    const busquedaTexto = buscarTexto(
      campanas,
      mensaje
    );

    let semanticas = [];
    let estadoSemantico = "correcta";

    try {
      semanticas = await buscarSemanticas(
        mensaje
      );

    } catch (error) {
      estadoSemantico = "fallo";

      console.warn(
        "Festival AI - Búsqueda semántica:",
        error.message
      );
    }

    // ======================================
    // COMBINAR RESULTADOS
    // ======================================

    const porId = new Map(
      campanas.map(c => [
        String(c.id),
        c
      ])
    );

    const seleccionadas = [];
    const vistos = new Set();

    const resultados = [
      ...semanticas.map(r =>
        porId.get(String(r.id)) || r
      ),
      ...busquedaTexto.registros
    ];

    for (const campana of resultados) {
      if (!campana) continue;

      const id = String(campana.id);

      if (vistos.has(id)) {
        continue;
      }

      vistos.add(id);
      seleccionadas.push(campana);

      // Máximo de 8 campañas por consulta.
      // Evita exceder límites de Groq.
      if (seleccionadas.length >= 8) {
        break;
      }
    }

    console.log(
      "Festival AI - Recuperación:",
      {
        registrosTotales: campanas.length,
        coincidenciasTextuales:
          busquedaTexto.total,
        resultadosSemanticos:
          semanticas.length,
        casosSeleccionados:
          seleccionadas.length,
        estadoSemantico
      }
    );

    // ======================================
    // INSTRUCCIONES DEL JURADO
    // ======================================

    const prompt = `
Eres FESTIVAL AI, un investigador y jurado
especializado en creatividad publicitaria.

Tu objetivo es analizar campañas publicitarias
reales usando exclusivamente registros de Supabase.

BASE DE DATOS:
Total de campañas: ${campanas.length}
Coincidencias textuales: ${busquedaTexto.total}
Resultados semánticos: ${semanticas.length}
Estado de búsqueda semántica: ${estadoSemantico}

La búsqueda semántica solo cubre las campañas
que ya tienen embeddings.

REGLAS PRIORITARIAS:

1. Nunca inventes campañas, premios,
agencias, marcas ni enlaces.

2. No inventes aplicaciones, tecnologías,
ejecuciones, resultados ni porcentajes.

3. Utiliza exclusivamente los hechos
documentados en los registros.

4. Diferencia los hechos documentados
de las interpretaciones creativas.

5. Si falta información, indica:
"No documentado en el registro".

6. Analiza el problema, insight,
concepto creativo y ejecución.

7. Explica por qué una idea es original.

8. Identifica similitudes y diferencias
entre campañas cuando corresponda.

9. Diferencia Grand Prix, Gold,
Silver, Bronze, Shortlist y NO GANO.

10. Una campaña puede ganar en una
categoría y no ganar en otras.

11. Nunca inventes enlaces.
Usa solamente el board registrado.

12. No afirmes que una campaña no existe
porque no apareció en los resultados.

13. No presentes búsquedas parciales
como si fueran exhaustivas.

14. Responde en español, con claridad.

15. Si solicitan cinco campañas,
presenta hasta cinco casos documentados.
No inventes casos para completar la lista.

16. Evita tablas innecesariamente extensas.

CAMPAÑAS RECUPERADAS:

${construirContexto(seleccionadas) || "No se recuperaron casos."}
`;

    // ======================================
    // ELEGIR PROVEEDOR
    // ======================================

    const preferencia = String(
      req.headers["x-strategy"] || "auto"
    ).toLowerCase();

    const orden =
      preferencia === "auto"
        ? [
            "gemini",
            "groq",
            "openrouter"
          ]
        : [preferencia];

    const proveedores = {
      gemini: () => llamarGemini(
        prompt,
        mensaje,
        resumenHistorial
      ),

      groq: () => llamarChatCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY,
        MODELOS_GROQ,
        prompt,
        mensaje,
        resumenHistorial,
        "groq"
      ),

      openrouter: () => llamarOpenRouter(
        prompt,
        mensaje,
        resumenHistorial
      )
    };

    let resultado = null;
    const errores = [];

    // ======================================
    // RESPALDO AUTOMATICO
    // ======================================

    for (const nombre of orden) {
      if (!proveedores[nombre]) {
        continue;
      }

      try {
        resultado =
          await proveedores[nombre]();

        if (resultado?.respuesta) {
          break;
        }

      } catch (error) {
        console.warn(
          "Festival AI - Proveedor:",
          nombre,
          error.message.slice(0, 420)
        );

        errores.push(
          `${nombre}: ${error.message.slice(0, 220)}`
        );
      }
    }

    if (!resultado) {
      throw new Error(
        "Ningún proveedor respondió: " +
        errores.join(" | ")
      );
    }

    // ======================================
    // RESPUESTA FINAL
    // ======================================

    return res.status(200).json({
      respuesta: resultado.respuesta,

      registrosTotales:
        campanas.length,

      coincidencias:
        busquedaTexto.total,

      casosSemanticos:
        semanticas.length,

      casosAnalizados:
        seleccionadas.length,

      busquedaSemantica:
        estadoSemantico,

      proveedor:
        resultado.proveedor,

      modelo:
        resultado.modelo
    });

  } catch (error) {
    console.error(
      "FESTIVAL AI - ERROR:",
      error.message
    );

    return res.status(500).json({
      error:
        error.message ||
        "Error interno del servidor."
    });
  }
}
