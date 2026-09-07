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

    const query = String(mensaje || '').toLowerCase();

    // 1. Detección de intenciones y filtros en la consulta
    const aniosDetectados = query.match(/\b(20\d{2})\b/g) || [];
    const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest', 'dubai lynx'].filter(f => query.includes(f));
    const categorias = ['outdoor', 'film', 'direct', 'print', 'pr', 'design', 'activation', 'purpose', 'media', 'creative data'].filter(c => query.includes(c));

    const palabrasIgnoradas = new Set(['para', 'como', 'este', 'esta', 'campañas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre']);
    const keywords = query
      .replace(/[^\wáéíóúñ\s]/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !palabrasIgnoradas.has(w));

    // 2. Sistema de Scoring con conversión explícita a String
    const calificadas = todasLasCampanas.map(c => {
      let score = 0;
      const metales = String(c.METAL_SUMMARY || c.METAL || '').toLowerCase();
      const titulo = String(c.Title || c.TITULO_PIEZA || '').toLowerCase();
      const marca = String(c.MARCA || '').toLowerCase();
      const cat = String(c.CATEGORIA_SUMMARY || c.CATEGORIA || '').toLowerCase();
      const fest = String(c.FESTIVAL || '').toLowerCase();
      const anio = String(c.AÑO || c.ANIO || '');
      const board = String(c['ANALISIS BOARD'] || '').toLowerCase();

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

      // Coincidencia por palabras clave
      keywords.forEach(kw => {
        if (titulo.includes(kw)) score += 30;
        if (marca.includes(kw)) score += 25;
        if (board.includes(kw)) score += 10;
      });

      return { ...c, _score: score };
    });

    // 3. Selección de las 40 campañas con mejor puntaje
    calificadas.sort((a, b) => b._score - a._score);
    const seleccionadas = calificadas.slice(0, 40);

    // 4. Formateo de las piezas seleccionadas
    const baseSintetizada = seleccionadas.map((c, i) => {
      const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
      const marca = String(c.MARCA || 'S/M');
      const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
      const cat = String(c.CATEGORIA_SUMMARY || c.CATEGORIA || '');
      const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
      
      let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
      if (board.length > 180) board = board.substring(0, 180) + '...';

      let maxMetal = 'SHORTLIST';
      if (/grand prix/i.test(metales)) maxMetal = 'GRAND PRIX';
      else if (/gold/i.test(metales)) maxMetal = 'GOLD';
      else if (/silver/i.test(metales)) maxMetal = 'SILVER';
      else if (/bronze/i.test(metales)) maxMetal = 'BRONZE';

      return `${i + 1}. [${maxMetal}] "${titulo}" (${marca} - ${fest}) | CAT: ${cat} | METALES: ${metales} | BOARD: ${board}`;
    }).join('\n');

    const promptSistema = `
Eres un analista estratégico y jurado de Cannes Lions.
Tienes sobre la mesa una selección optimizada de campañas relevantes:

SELECCIÓN DE CASOS:
${baseSintetizada}

PAUTAS DE RESPUESTA:
1. Responde de forma directa, analítica y sin roleplay ni acotaciones teatrales.
2. Si solicitan un versus:
   - Contrasta ganadoras (Grand Prix / Gold) frente a Shortlists / No ganadoras.
   - Presenta la síntesis comparativa en una **Tabla Markdown** (Columnas: Caso & Marca | Metal | Tensión / Insight | Brecha Estratégica).
   - Analiza la diferencia entre la transformación de negocio/cultural vs. la mera representación superficial.
3. Cita nombres exactos de piezas y marcas presentes en el listado.
4. Concluye con una pregunta estratégica orientada al brief o reto creativo.
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
