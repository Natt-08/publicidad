import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar OPENROUTER_API_KEY en Vercel.' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    const query = mensaje.toLowerCase();

    // 1. Detección de intenciones y filtros en la consulta
    const aniosDetectados = query.match(/\b(20\d{2})\b/g) || [];
    const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest', 'dubai lynx'].filter(f => query.includes(f));
    const categorias = ['outdoor', 'film', 'direct', 'print', 'pr', 'design', 'activation', 'purpose', 'media', 'creative data'].filter(c => query.includes(c));

    // Palabras clave ignorando términos comunes
    const palabrasIgnoradas = new Set(['para', 'como', 'este', 'esta', 'campañas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre']);
    const keywords = query
      .replace(/[^\wáéíóúñ\s]/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !palabrasIgnoradas.has(w));

    // 2. Sistema de Scoring y Filtrado en Memoria
    const calificadas = todasLasCampanas.map(c => {
      let score = 0;
      const metales = (c.METAL_SUMMARY || c.METAL || '').toLowerCase();
      const titulo = (c.Title || c.TITULO_PIEZA || '').toLowerCase();
      const marca = (c.MARCA || '').toLowerCase();
      const cat = (c.CATEGORIA_SUMMARY || c.CATEGORIA || '').toLowerCase();
      const fest = (c.FESTIVAL || '').toLowerCase();
      const anio = String(c.AÑO || c.ANIO || '');
      const board = (c['ANALISIS BOARD'] || '').toLowerCase();

      // Priorización de metales mayores
      if (metales.includes('grand prix')) score += 25;
      else if (metales.includes('gold')) score += 15;
      else if (metales.includes('silver')) score += 8;
      else if (metales.includes('bronze')) score += 4;

      // Coincidencia por año
      if (aniosDetectados.length > 0) {
        if (aniosDetectados.includes(anio)) score += 30;
        else score -= 15;
      }

      // Coincidencia por festival
      festivales.forEach(f => {
        if (fest.includes(f)) score += 20;
      });

      // Coincidencia por categoría
      categorias.forEach(catItem => {
        if (cat.includes(catItem)) score += 25;
      });

      // Coincidencia por palabras clave en título, marca o board
      keywords.forEach(kw => {
        if (titulo.includes(kw)) score += 30;
        if (marca.includes(kw)) score += 25;
        if (board.includes(kw)) score += 10;
      });

      return { ...c, _score: score };
    });

    // 3. Selección del subconjunto más representativo (máximo 40 campañas)
    calificadas.sort((a, b) => b._score - a._score);
    const seleccionadas = calificadas.slice(0, 40);

    // 4. Formateo compacto del subconjunto seleccionado
    const baseSintetizada = seleccionadas.map((c, i) => {
      const titulo = c.Title || c.TITULO_PIEZA || 'S/T';
      const marca = c.MARCA || 'S/M';
      const fest = `${c.FESTIVAL || 'CANNES'} ${c.AÑO || c.ANIO || ''}`.trim();
      const cat = c.CATEGORIA_SUMMARY || c.CATEGORIA || '';
      const metales = c.METAL_SUMMARY || c.METAL || 'NO GANO';
      
      let board = (c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
      if (board.length > 180) board = board.substring(0, 180) + '...';

      let maxMetal = 'SHORTLIST';
      if (/grand prix/i.test(metales)) maxMetal = 'GRAND PRIX';
      else if (/gold/i.test(metales)) maxMetal = 'GOLD';
      else if (/silver/i.test(metales)) maxMetal = 'SILVER';
      else if (/bronze/i.test(metales)) maxMetal = 'BRONZE';

      return `${i + 1}. [${maxMetal}] "${titulo}" (${marca} - ${fest}) | CAT: ${cat} | METALES: ${metales} | BOARD: ${board}`;
    }).join('\n');

    const promptSistema = `
Eres un analista estratégico y jurado experto de Cannes Lions.
Tienes sobre la mesa una selección optimizada de las campañas más relevantes extraídas de nuestra base de datos para responder a la consulta actual:

SELECCIÓN DE CASOS RELEVANTES:
${baseSintetizada}

INSTRUCCIONES CLAVE:
1. Responde de forma directa, analítica y sin rodeos corporativos ni roleplay teatral.
2. Si te piden un versus de categoría, año o temática:
   - Contrasta los casos ganadores (Grand Prix / Gold) frente a los que quedaron en Shortlist o no ganaron.
   - Presenta la síntesis comparativa mediante una **Tabla Markdown** limpia (Columnas: Caso & Marca | Metal | Tensión / Insight | Brecha Estratégica).
   - Analiza por qué la idea ganadora transformó el negocio o la cultura mientras que la no ganadora se quedó en un gesto superficial o predecible.
3. Cita obligatoriamente los nombres y marcas exactas que aparecen en la lista.
4. Concluye con una pregunta estratégica orientada a desafiar el brief o reto planteado.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.com",
        "X-Title": "Festival AI"
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3:free",
        messages: [
          { role: "system", content: promptSistema },
          { role: "user", content: mensaje }
        ],
        temperature: 0.2,
        max_tokens: 1500
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const err = data.error?.message || response.statusText;
      return res.status(500).json({ error: `Error OpenRouter: ${err}` });
    }

    const respuestaTexto = data.choices?.[0]?.message?.content;
    if (!respuestaTexto) {
      return res.status(500).json({ error: 'Respuesta vacía del proveedor.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
