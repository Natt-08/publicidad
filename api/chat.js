
export const config = {
  maxDuration: 60
};

// Normalizar texto para buscar coincidencias
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Hacer peticiones con tiempo máximo de espera
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

// Obtener todas las campañas de Supabase
async function obtenerCampanas() {
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

  const todas = [];
  const cantidadPorPagina = 500;

  for (let inicio = 0; inicio < 100000; inicio += cantidadPorPagina) {
    const parametros = new URLSearchParams({
      select: "titulo,marca,festival,anio,categorias,metales,agencia,analisis_board,board_image",
      order: "id.asc",
      offset: String(inicio),
      limit: String(cantidadPorPagina)
    });

    const respuesta = await fetchConTimeout(
      `${url}/rest/v1/campanas?${parametros}`,
      {
        headers: {
          apikey: key,
          ...(key.startsWith("sb_secret_")
            ? {}
            : { Authorization: `Bearer ${key}` })
        }
      }
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      throw new Error(
        `Supabase respondió ${respuesta.status}: ${detalle.slice(0, 250)}`
      );
    }

    const registros = await respuesta.json();

    if (!Array.isArray(registros)) {
      throw new Error("Respuesta inválida de Supabase.");
    }

    todas.push(...registros);

    if (registros.length < cantidadPorPagina) {
      break;
    }
  }

  return todas;
}

// Identificar palabras clave de una consulta
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

// Buscar campañas relevantes en toda la colección
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
      "cancer", "breast", "tumor", "oncolog", "mammogram"
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

  const anios = consulta.match(/\b20\d{2}\b/g) || [];

  const festivales = [
    "cannes",
    "eurobest",
    "dubai lynx",
    "clio",
    "el ojo",
    "d&ad"
  ].filter(f => consulta.includes(f));

  const solicitaGrandPrix = consulta.includes("grand prix");

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

    if (solicitaGrandPrix && metales.includes("grand prix")) {
      score += 300;
    }

    if (consulta.includes("gold") && metales.includes("gold")) {
      score += 150;
    }

    if (consulta.includes("silver") && metales.includes("silver")) {
      score += 150;
    }

    if (consulta.includes("bronze") && metales.includes("bronze")) {
      score += 150;
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

// Preparar casos para la inteligencia artificial
function construirContexto(campanas) {
  return campanas.map((c, i) => {
    const analisis = String(c.analisis_board || "")
      .replace(/\s+/g, " ")
      .trim();

    const limite = i < 5 ? 1500 : 600;

    return [
      `CASO ${i + 1}`,
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

// Función principal de Vercel
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
      error: "No hay claves API de inteligencia artificial configuradas."
    });
  }

  try {
    const campanas = await obtenerCampanas();

    const historialSeguro = Array.isArray(historial)
      ? historial.slice(-4).filter(m =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string"
        )
      : [];

    const consultasPrevias = historialSeguro
      .filter(m => m.role === "user")
      .slice(-2)
      .map(m => m.content)
      .join(" ");

    const busqueda = buscarCampanas(
      campanas,
      `${consultasPrevias} ${mensaje}`
    );

    const contexto = construirContexto(
      busqueda.seleccionadas
    );

    const promptSistema = `
Eres FESTIVAL AI, un investigador y jurado especializado
en creatividad publicitaria y festivales internacionales.

Tu objetivo es analizar campañas publicitarias reales
utilizando exclusivamente los registros recuperados
de la base de datos del usuario.

BASE DE DATOS:
Total de campañas registradas: ${campanas.length}
Coincidencias textuales encontradas: ${busqueda.totalCoincidencias}
Campañas entregadas para análisis: ${busqueda.seleccionadas.length}

CAMPAÑAS RECUPERADAS:
${contexto || "No se encontraron coincidencias textuales."}

REGLAS:

1. No inventes campañas, premios, marcas ni enlaces.

2. Diferencia claramente los premios Gold, Silver,
Bronze, Grand Prix, Shortlist y NO GANO.

3. Una misma campaña puede ganar en una categoría
y no ganar en otras. No confundas esos resultados.

4. Analiza las ideas desde la perspectiva creativa:
problema, insight, concepto, ejecución y originalidad.

5. Cuando compares campañas, identifica semejanzas
y diferencias concretas.

6. Si el usuario solicita enlaces, utiliza los enlaces
que aparecen en los registros.

7. Las campañas recuperadas son solo una selección.
No afirmes que algo no existe en toda la base
si no aparece en esta selección.

8. Si la pregunta requiere examinar todas las campañas,
advierte que el análisis es parcial y no exhaustivo.

9. Si falta información en el análisis de un board,
indícalo claramente.

10. No confundas una coincidencia de palabras con una
similitud creativa demostrada.

11. Responde en español, de forma clara, precisa
y con información verificable.
`;

    const mensajes = [
      {
        role: "system",
        content: promptSistema
      },
      ...historialSeguro,
      {
        role: "user",
        content: mensaje
      }
    ];

    async function llamarOpenAICompatible(
      endpoint,
      key,
      modelos,
      proveedor
    ) {
      if (!key) throw new Error(`Sin clave de ${proveedor}`);

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
                      "HTTP-Referer": "https://festival-ai.vercel.app",
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
            10000
          );

          const data = await respuesta.json();

          if (!respuesta.ok) {
            console.warn(proveedor, modelo, respuesta.status);
            continue;
          }

          const texto = data.choices?.[0]?.message?.content;

          if (typeof texto === "string" && texto.trim()) {
            return texto;
          }

        } catch (error) {
          console.warn(proveedor, modelo, error.message);
        }
      }

      throw new Error(`No hubo respuesta válida de ${proveedor}`);
    }

    async function llamarGemini() {
      if (!geminiKey) throw new Error("Sin clave Gemini");

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
                    text: `${promptSistema}\n\nCONSULTA:\n${mensaje}`
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
            console.warn("Gemini", modelo, respuesta.status);
            continue;
          }

          const texto = data.candidates?.[0]?.content?.parts
            ?.map(p => p.text || "")
            .join("");

          if (texto?.trim()) return texto;

        } catch (error) {
          console.warn("Gemini", modelo, error.message);
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
          "openai/gpt-oss-20b:free",
          "google/gemma-3-27b-it:free"
        ],
        "OpenRouter"
      );
    }

    const proveedores = {
      gemini: llamarGemini,
      groq: llamarGroq,
      openrouter: llamarOpenRouter
    };

    const orden = estrategia === "auto"
      ? ["gemini", "groq", "openrouter"]
      : [estrategia];

    let respuestaTexto = null;
    const errores = [];

    for (const proveedor of orden) {
      if (!proveedores[proveedor]) continue;

      try {
        respuestaTexto = await proveedores[proveedor]();
        if (respuestaTexto) break;
      } catch (error) {
        errores.push(`${proveedor}: ${error.message}`);
      }
    }

    if (!respuestaTexto) {
      throw new Error(
        "Ningún proveedor respondió. " + errores.join("; ")
      );
    }

    return res.status(200).json({
      respuesta: respuestaTexto,
      registrosTotales: campanas.length,
      coincidencias: busqueda.totalCoincidencias,
      casosAnalizados: busqueda.seleccionadas.length
    });

  } catch (error) {
    console.error("Festival AI:", error);

    return res.status(500).json({
      error: error.message || "Error interno del servidor."
    });
  }
}
