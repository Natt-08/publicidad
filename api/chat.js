import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60 // Pide a Vercel el máximo tiempo permitido
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

    const baseSintetizada = todasLasCampanas.map((c, i) => {
      const metal = (c.METAL || c.metal || 'SHORTLIST / NO GANADORA').toUpperCase();
      const pieza = c.TITULO_PIEZA || c.titulo_pieza || 'Sin título';
      const marca = c.MARCA || c.marca || 'Sin marca';
      const fest = `${c.FESTIVAL || c.festival || 'Cannes'} ${c.ANIO || c.anio || ''}`.trim();
      const ins = (c.insight_problema || c.insight || '').replace(/\s+/g, ' ').trim();
      const ide = (c.idea_ejecucion || c.idea || '').replace(/\s+/g, ' ').trim();
      const url = c.LINK || c.link || '';

      return `${i + 1}. [${metal}] "${pieza}" (${marca} - ${fest}) | INSIGHT: ${ins} | IDEA: ${ide}${url ? ` | LINK: ${url}` : ''}`;
    }).join('\n');

    const promptSistema = `
Eres un analista estratégico y jurado experto de Cannes Lions.
Tienes un registro de 300 campañas (Grand Prix / Oros frente a Shortlists y no ganadoras):

=== BASE DE CAMPAÑAS ===
${baseSintetizada}
========================

INSTRUCCIONES CLAVE:
1. Cero roleplay o acotaciones teatrales. Ve al grano con criterio estratégico puro.
2. Si piden un versus de 5 vs 5:
   - Toma 5 casos con [GRAND PRIX] y 5 casos con [SHORTLIST / NO GANADORA] de la lista.
   - Contrasta qué separó el éxito del fracaso en cada duelo: la tensión real vs el cliché, el rol del producto y la audacia del craft.
3. Cita obligatoriamente los nombres exactos de las piezas y marcas presentes en el archivo.
4. Concluye devolviendo una pregunta estratégica sobre el reto creativo actual.
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
        temperature: 0.3,
        max_tokens: 2500
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const err = data.error?.message || response.statusText;
      return res.status(500).json({ error: `Error de OpenRouter: ${err}` });
    }

    const choice = data.choices?.[0]?.message;
    const respuestaTexto = choice?.content || (typeof choice?.reasoning === 'string' ? choice.reasoning : null);

    if (!respuestaTexto) {
      return res.status(500).json({ error: 'El proveedor devolvió una respuesta vacía. Reintenta la consulta.' });
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
