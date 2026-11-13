
export const config = {
  maxDuration: 60
};

// ==========================================
// FESTIVAL AI - SUPABASE + BUSQUEDA SEMANTICA
// ==========================================

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function fetchConTimeout(url, opciones, tiempo = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tiempo);

  try {
    return await fetch(url, {
      ...opciones,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 1. CONFIGURACION DE SUPABASE
// ==========================================

function configurarSupabase() {
  const url = (process.env.SUPABASE_URL || "")
    .replace(/\/$/, "");

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
      ...(key.startsWith("sb_secret_")
        ? {}
        : { Authorization: `Bearer ${key}` })
    }
  };
}

// ==========================================
// 2. RECUPERAR TODAS LAS CAMPANAS
// ==========================================

async function obtenerCampanas() {
  const { url, headers } = configurarSupabase();

  const todas = [];
  const cantidadPorPagina = 500;

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

  for (let inicio = 0; inicio < 100000; inicio += cantidadPorPagina) {
    const fin = inicio + cantidadPorPagina - 1;

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
          Range: `${inicio}-${fin}`
        }
      },
      12000
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text();

      throw new Error(
        `Supabase respondió ${respuesta.status}: ` +
        detalle.slice(0, 350)
      );
    }

    const registros = await respuesta.json();

    if (!Array.isArray(registros)) {
      throw new Error("Supabase devolvió un formato inválido.");
    }

    todas.push(...registros);

    if (registros.length < cantidadPorPagina) {
      break;
    }
  }

  // Evitar que la IA confunda problemas de lectura
  // con una base de datos vacía.
  if (todas.length === 0) {
    throw new Error(
      "Supabase devolvió 0 campañas. " +
      "Revisa SUPABASE_URL, los permisos y la clave secreta."
    );
  }

  console.log("FESTIVAL AI - Campañas recuperadas:", todas.length);

  return todas;
}

// ==========================================
// 3. BUSQUEDA TRADICIONAL
// ==========================================

function obtenerPalabras(texto) {
  const excluidas = new Set([
    "para", "como", "esta", "este", "estos", "estas",
    "campanas", "campana", "cuales", "quiero", "dame",
    "busca", "analiza", "explica", "sobre", "entre",
    "todas", "todos", "tiene", "tienen", "hacer",
    "donde", "cuando", "porque", "desde", "hasta",
    "ganaron", "ganadoras", "datos", "base", "dime",
    "puedes", "ejemplos", "casos", "ideas", "algo",
    "alguna", "alguno", "fueron", "fue", "son",
    "con", "sin", "una", "uno", "los", "las",
    "del", "por", "que", "sus", "hay", "mas",
    "de", "la", "el", "en", "un", "al",
    "lo", "le", "se", "me", "es", "no", "si"
  ]);

  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(p => p.length >= 3 && !excluidas.has(p));
}

function buscarCampanas(campanas, pregunta) {
  const consulta = normalizar(pregunta);
  const palabras = obtenerPalabras(pregunta);

  const sinonimos = [];

  if (/gaming|videojuego|esport|gamificacion/.test(consulta)) {
    sinonimos.push(
      "gaming", "game", "gamer", "videojuego",
      "fortnite", "minecraft", "esport", "twitch"
    );
  }

  if (/cancer|tumor|oncolog|mama/.test(consulta)) {
    sinonimos.push(
      "cancer", "breast", "tumor",
      "oncolog", "mammogram"
    );
  }

  if (/termograf|infrarroj|calor/.test(consulta)) {
    sinonimos.push(
      "termograf", "thermal", "infrared", "termic"
    );
  }

  if (/halloween|terror|miedo/.test(consulta)) {
    sinonimos.push(
      "halloween", "horror", "terror", "miedo"
    );
  }

  if (/participativ|interactiv|experiencia/.test(consulta)) {
    sinonimos.push(
      "interactive", "participation", "participacion",
      "experiencia", "interactivo", "activacion",
      "engagement"
    );
  }

  const anios = consulta.match(/\b20\d{2}\b/g) || [];

  const festivales = [
    "cannes",
    "eurobest",
    "dubai lynx",
    "clio",
    "el ojo",
    "d&ad"
  ].filter(f => consulta.includes(f));

  const resultados = campanas.map(c => {
    const titulo = normalizar(c.titulo);
    const marca = normalizar(c.marca);
    const board = normalizar(c.analisis_board);
    const categorias = normalizar(c.categorias);
    const metales = normalizar(c.metales);
    const agencia = normalizar(c.agencia);
    const festival = normalizar(c.festival);

    let score = 0;

    for (const palabra of palabras) {
      if (titulo.includes(palabra)) score += 120;
      if (marca.includes(palabra)) score += 100;
      if (agencia.includes(palabra)) score += 65;
      if (categorias.includes(palabra)) score += 60;
      if (board.includes(palabra)) score += 45;
    }

    for (const sinonimo of sinonimos) {
      if (titulo.includes(sinonimo)) score += 180;
      if (categorias.includes(sinonimo)) score += 110;
      if (board.includes(sinonimo)) score += 90;
    }

    if (anios.includes(String(c.anio))) {
      score += 40;
    }

    for (const f of festivales) {
      if (festival.includes(f)) score += 50;
    }

    for (const metal of [
      "grand prix", "gold", "silver", "bronze"
    ]) {
      if (
        consulta.includes(metal) &&
        metales.includes(metal)
      ) {
        score += 150;
      }
    }

    return { ...c, _score: score };
  });

  resultados.sort((a, b) => b._score - a._score);

  const encontrados = resultados.filter(c => c._score > 0);

  return {
    totalCoincidencias: encontrados.length,
    seleccionadas: encontrados.slice(0, 20)
  };
}

// ==========================================
// 4. BUSQUEDA SEMANTICA CON GEMINI
// ==========================================

async function buscarSemanticas(pregunta) {
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    throw new Error("Falta GEMINI_API_KEY");
  }

  const { url, headers } = configurarSupabase();

  const respuestaEmbedding = await fetchConTimeout(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: {
          parts: [{ text: pregunta }]
        },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768
      })
    },
    12000
  );

  const datosEmbedding = await respuestaEmbedding.json();

  if (!respuestaEmbedding.ok) {
    throw new Error(
      datosEmbedding.error?.message ||
      "Gemini no pudo generar el embedding."
    );
  }

  const valores = datosEmbedding.embedding?.values;

  if (!Array.isArray(valores) || valores.length !== 768) {
    throw new Error("Embedding de consulta inválido.");
  }

  const norma = Math.sqrt(
    valores.reduce((s, n) => s + n * n, 0)
  );

  if (!norma) {
    throw new Error("Vector vacío.");
  }

  const vector = valores.map(n => n / norma);

  // Consultar la función RPC de PostgreSQL
  const respuesta = await fetchConTimeout(
    `${url}/rest/v1/rpc/buscar_campanas_semanticas`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query_embedding: JSON.stringify(vector),
        cantidad: 20
      })
    },
    12000
  );

  const resultados = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      resultados.message ||
      `Error RPC ${respuesta.status}`
    );
  }

  if (!Array.isArray(resultados)) {
    throw new Error("Respuesta semántica inválida.");
  }

  return resultados;
}

// ==========================================
// 5. CONSTRUIR CONTEXTO PARA LA IA
// ==========================================

function construirContexto(campanas) {
  return campanas.map((c, i) => {
    const analisis = String(c.analisis_board || "")
      .replace(/\s+/g, " ")
      .trim();

    const limite = i < 5 ? 1500 : 600;

    return [
      `CASO ${i + 1}`,
      `ID: ${c.id}`,
      `TÍTULO: ${c.titulo || "Sin título"}`,
      `MARCA: ${c.marca || "No registrada"}`,
      `FESTIVAL: ${c.festival || "No registrado"}`,
      `AÑO: ${c.anio || "No registrado"}`,
      `AGENCIA: ${c.agencia || "No registrada"}`,
      `CATEGORÍAS: ${c.categorias || "No registradas"}`,
      `PREMIOS: ${c.metales || "No registrados"}`,
      `ANÁLISIS: ${analisis.slice(0, limite) || "No disponible"}`,
      `ENLACE: ${c.board_image || "No disponible"}`
    ].join("\n");
  }).join("\n\n----------------------\n\n");
}

// ==========================================
// 6. FUNCION PRINCIPAL
// ==========================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
    });
  }

  const { mensaje, historial = [] } = req.body || {};

  if (!mensaje || typeof mensaje !== "string") {
    return res.status(400).json({
      error: "Escribe una consulta válida."
    });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  const estrategia = req.headers["x-strategy"] || "auto";

  if (!geminiKey && !groqKey && !openrouterKey) {
    return res.status(500).json({
      error: "No hay claves API configuradas en Vercel."
    });
  }

  try {
    // ======================================
    // RECUPERAR BASE COMPLETA
    // ======================================

    const campanas = await obtenerCampanas();

    console.log("FESTIVAL AI - DIAGNOSTICO", {
      totalCampanas: campanas.length,
      proyecto: new URL(process.env.SUPABASE_URL).hostname
    });

    // ======================================
    // DETECTAR PREGUNTAS DE CONTEO
    // ======================================

    const preguntaNorm = normalizar(mensaje);

    if (
      /cuantas campanas|cuantos registros|total de campanas/.test(
        preguntaNorm
      ) &&
      !/marca|festival|agencia|categoria|premio|ano|año/.test(
        preguntaNorm
      )
    ) {
      return res.status(200).json({
        respuesta:
          `Actualmente tengo **${campanas.length.toLocaleString("es-PE")} campañas publicitarias** registradas en Supabase.`,
        registrosTotales: campanas.length,
        coincidencias: campanas.length,
        casosAnalizados: 0,
        busquedaSemantica: "no necesaria"
      });
    }

    // ======================================
    // HISTORIAL
    // ======================================

    const historialSeguro = Array.isArray(historial)
      ? historial.slice(-6).filter(m =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string"
        )
      : [];

    const consultasPrevias = historialSeguro
      .filter(m => m.role === "user")
      .slice(-2)
      .map(m => m.content)
      .join(" ");

    const consultaCompleta =
      `${consultasPrevias} ${mensaje}`.trim();

    // ======================================
    // BUSQUEDA TRADICIONAL
    // ======================================

    const busqueda = buscarCampanas(
      campanas,
      consultaCompleta
    );

    // ======================================
    // BUSQUEDA SEMANTICA
    // ======================================

    let casosSemanticos = [];
    let estadoSemantico = "pendiente";

    try {
      casosSemanticos = await buscarSemanticas(
        consultaCompleta
      );

      estadoSemantico = "correcta";

      console.log(
        "FESTIVAL AI - Resultados semánticos:",
        casosSemanticos.length
      );

    } catch (error) {
      estadoSemantico = "fallo";

      console.error(
        "FESTIVAL AI - Error semántico:",
        error.message
      );
    }

    // ======================================
    // COMBINAR RESULTADOS
    // ======================================

    const porId = new Map(
      campanas.map(c => [String(c.id), c])
    );

    const seleccionadas = [];
    const idsIncluidos = new Set();

    const resultadosCombinados = [
      ...casosSemanticos.map(r =>
        porId.get(String(r.id)) || r
      ),
      ...busqueda.seleccionadas
    ];

    for (const campana of resultadosCombinados) {
      if (!campana) continue;

      const id = String(campana.id);

      if (idsIncluidos.has(id)) continue;

      idsIncluidos.add(id);
      seleccionadas.push(campana);

      if (seleccionadas.length >= 20) break;
    }

    const contexto = construirContexto(seleccionadas);

    console.log("FESTIVAL AI - RECUPERACION", {
      registrosTotales: campanas.length,
      coincidenciasTextuales: busqueda.totalCoincidencias,
      resultadosSemanticos: casosSemanticos.length,
      casosSeleccionados: seleccionadas.length,
      estadoSemantico
    });

    // ======================================
    // INSTRUCCIONES DEL JURADO
    // ======================================

    const promptSistema = `
    
REGLAS PRIORITARIAS DE PRECISION PUBLICITARIA:

Eres un investigador riguroso de campañas publicitarias.
Tu objetivo es analizar creatividad, no inventar ejecuciones.

1. FUENTES:
Solo puedes presentar como hechos los datos que estén
incluidos en los registros recuperados de Supabase.

2. NO INVENTAR:
Nunca inventes aplicaciones, plataformas, tecnologías,
acciones, mecánicas, resultados, porcentajes, premios,
agencias o participaciones del público.

3. PROBLEMA:
Identifica el problema que resolvió la campaña.
Si el registro no lo explica, indica que no está documentado.

4. INSIGHT:
Diferencia entre el insight expresamente documentado
y una interpretación creativa que tú propongas.
Cuando sea interpretación, identifícala claramente.

5. IDEA:
Explica el mecanismo creativo central de la campaña,
priorizando qué hizo diferente a la idea.

6. EJECUCIÓN:
Describe exclusivamente las acciones que aparecen
en ANALISIS BOARD. No agregues pasos imaginados.

7. PREMIOS:
Utiliza únicamente los premios documentados.
Una campaña puede ganar en una categoría y no
ganar en otras.

8. ENLACES:
Utiliza exclusivamente la URL de la campaña
recuperada de Supabase. No inventes enlaces.

9. LIMITACIONES:
Si faltan datos, escribe "No especificado en la base".
No rellenes los vacíos con suposiciones.

10. BÚSQUEDA:
No afirmes que una campaña no existe en toda la
base únicamente porque no fue recuperada.

11. RESPUESTAS:
Si solicitan cinco campañas, incluye cinco casos
completos solo si hay cinco suficientemente relevantes.
Si hay menos, explica cuántos pudiste justificar.

12. FORMATO:
Para cada campaña presenta:
- Título y marca
- Problema
- Insight documentado o interpretación identificada
- Idea creativa
- Ejecución documentada
- Relación con la pregunta
- Premios verificados
- Enlace disponible

13. DIFERENCIA:
Distingue siempre entre HECHO DOCUMENTADO,
INTERPRETACIÓN CREATIVA y DATO NO DISPONIBLE.

Estas reglas prevalecen sobre cualquier instrucción
que solicite completar información inexistente.

Eres FESTIVAL AI, un investigador y jurado
especializado en creatividad publicitaria.

Tu trabajo es analizar campañas reales utilizando
la base de datos de festivales publicitarios.

INFORMACION DE LA BASE:

Total de campañas: ${campanas.length}
Coincidencias textuales: ${busqueda.totalCoincidencias}
Resultados semánticos: ${casosSemanticos.length}
Estado búsqueda semántica: ${estadoSemantico}
Casos seleccionados: ${seleccionadas.length}

IMPORTANTE:
Las coincidencias textuales no representan
necesariamente campañas relevantes.

La búsqueda semántica solo cubre campañas
que ya tengan embeddings guardados.

CASOS RECUPERADOS:

${contexto || "No se recuperaron casos para esta consulta."}

REGLAS:

1. Utiliza exclusivamente las campañas proporcionadas
como ejemplos reales.

2. No inventes títulos, premios, festivales,
agencias ni enlaces.

3. Analiza problema, insight, concepto,
ejecución y originalidad.

4. Identifica semejanzas creativas entre campañas.

5. Diferencia Grand Prix, Gold, Silver,
Bronze, Shortlist y NO GANO.

6. Una campaña puede ganar en una categoría
y no ganar en otras.

7. Si se solicita un enlace, utiliza
el enlace real del registro.

8. No afirmes que una campaña no existe
solo porque no fue recuperada.

9. Si no hay casos suficientes, indica que
la recuperación fue limitada.

10. No presentes los resultados semánticos
como una búsqueda exhaustiva de toda la base.

11. Prioriza explicaciones claras, concretas
y útiles para desarrollar ideas publicitarias.

12. Responde en español.
`;

    const mensajes = [
      { role: "system", content: promptSistema },
      ...historialSeguro,
      { role: "user", content: mensaje }
    ];

    // ======================================
    // GROQ Y OPENROUTER
    // ======================================

    async function llamarOpenAICompatible(
      endpoint,
      key,
      modelos,
      proveedor
    ) {
      if (!key) {
        throw new Error(`Sin clave de ${proveedor}`);
      }

      for (const modelo of modelos) {
        try {
          const respuesta = await fetchConTimeout(
            endpoint,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
                ...(proveedor === "OpenRouter"
                  ? {
                      "HTTP-Referer":
                        "https://festival-ai.vercel.app",
                      "X-Title": "Festival AI"
                    }
                  : {})
              },
              body: JSON.stringify({
                model: modelo,
                messages: mensajes,
                temperature: 0.2,
                max_tokens: 1600
              })
            },
            12000
          );

          const data = await respuesta.json();

          if (!respuesta.ok) {
            console.warn(
              proveedor,
              modelo,
              respuesta.status,
              data.error?.message || ""
            );
            continue;
          }

          const texto =
            data.choices?.[0]?.message?.content;

          if (typeof texto === "string" && texto.trim()) {
            return texto;
          }

        } catch (error) {
          console.warn(
            proveedor,
            modelo,
            error.message
          );
        }
      }

      throw new Error(
        `No hubo respuesta válida de ${proveedor}`
      );
    }

    // ======================================
    // GEMINI
    // ======================================

    async function llamarGemini() {
      if (!geminiKey) {
        throw new Error("Sin clave Gemini");
      }

      const modelos = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite"
      ];

      for (const modelo of modelos) {
        try {
          const respuesta = await fetchConTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": geminiKey
              },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [{
                    text:
                      `${promptSistema}\n\n` +
                      `HISTORIAL:\n` +
                      historialSeguro.map(m =>
                        `${m.role}: ${m.content}`
                      ).join("\n") +
                      `\n\nCONSULTA ACTUAL:\n${mensaje}`
                  }]
                }],
                generationConfig: {
                  temperature: 0.2,
                  maxOutputTokens: 2000
                }
              })
            },
            12000
          );

          const data = await respuesta.json();

          if (!respuesta.ok) {
            console.warn(
              "Gemini",
              modelo,
              respuesta.status,
              data.error?.message || ""
            );
            continue;
          }

          const texto = data.candidates?.[0]?.content?.parts
            ?.map(p => p.text || "")
            .join("");

          if (texto?.trim()) return texto;

        } catch (error) {
          console.warn(
            "Gemini",
            modelo,
            error.message
          );
        }
      }

      throw new Error("Gemini no respondió.");
    }

    async function llamarGroq() {
      return llamarOpenAICompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        groqKey,
        [
          "openai/gpt-oss-120b",
          "openai/gpt-oss-20b"
        ],
        "Groq"
      );
    }

    async function llamarOpenRouter() {
      return llamarOpenAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        openrouterKey,
        [
          "openrouter/free",
          "google/gemma-3-27b-it:free"
        ],
        "OpenRouter"
      );
    }

    // ======================================
    // CASCADA AUTOMATICA DE MODELOS
    // ======================================

    const proveedores = {
      gemini: llamarGemini,
      groq: llamarGroq,
      openrouter: llamarOpenRouter
    };

    const orden = estrategia === "auto"
      ? ["gemini", "groq", "openrouter"]
      : [estrategia];

    let respuestaTexto = null;
    let proveedorUtilizado = null;
    const errores = [];

    for (const proveedor of orden) {
      if (!proveedores[proveedor]) continue;

      try {
        respuestaTexto = await proveedores[proveedor]();

        if (respuestaTexto) {
          proveedorUtilizado = proveedor;
          break;
        }

      } catch (error) {
        errores.push(
          `${proveedor}: ${error.message}`
        );
      }
    }

    if (!respuestaTexto) {
      throw new Error(
        "Ningún proveedor respondió. " +
        errores.join("; ")
      );
    }

    // ======================================
    // RESPUESTA FINAL
    // ======================================

    return res.status(200).json({
      respuesta: respuestaTexto,
      registrosTotales: campanas.length,
      coincidencias: busqueda.totalCoincidencias,
      casosSemanticos: casosSemanticos.length,
      casosAnalizados: seleccionadas.length,
      busquedaSemantica: estadoSemantico,
      proveedor: proveedorUtilizado
    });

  } catch (error) {
    console.error(
      "FESTIVAL AI - ERROR GENERAL:",
      error
    );

    return res.status(500).json({
      error: error.message ||
        "Error interno del servidor."
    });
  }
}
