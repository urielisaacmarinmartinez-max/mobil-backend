import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const keys = require('./google-auth.json');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const serviceAccountAuth = new JWT({
  email: keys.client_email,
  key: keys.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// REEMPLAZA CON TU ID REAL
const doc = new GoogleSpreadsheet('1GALSgq5RhFv103c307XYeNoorQ5gAzxFR1Q64XMGr7Q', serviceAccountAuth);

// 1. LOGIN (Pestaña "Usuarios")
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Usuarios']; 
        const rows = await sheet.getRows();
        
        const user = rows.find(r => {
            const rowEmail = r.get('EMAIL');
            const rowPass = r.get('PASSWORD');
            return rowEmail && rowPass && 
                   rowEmail.toString().toLowerCase() === email.toLowerCase() && 
                   rowPass.toString() === password.toString();
        });
        
        if (user) {
            res.json({ 
                success: true, 
                user: {
                    nombre: user.get('NOMBRE'),
                    rol: user.get('ROL'),
                    estaciones: user.get('ESTACIONES')
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Datos incorrectos' });
        }
    } catch (error) {
        console.error("Error en Login:", error);
        res.status(500).json({ success: false });
    }
});
// 2. CARGAR ESTACIONES (Pestaña "Estaciones")
app.get('/api/estaciones', async (req, res) => {
    try {
        await doc.loadInfo(); // <--- ESTA LÍNEA ES VITAL
        const sheet = doc.sheetsByTitle['Estaciones']; 
        
        if (!sheet) {
            console.error("No se encontró la pestaña 'Estaciones'");
            return res.status(404).json({ error: "Hoja no encontrada" });
        }

        const rows = await sheet.getRows();
        
        const estaciones = rows.map(row => ({
            id: row.get('ID_Estacion') || '',
            nombre: row.get('Nombre') || '',
            direccion: row.get('Dirección') || '',
            // Manejo más robusto de números y strings
            credito: parseFloat(String(row.get('Crédito Disponible') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
            precios: {
                Extra: parseFloat(String(row.get('Precio Extra') || '0').replace(/[$,]/g, '')) || 0,
                Supreme: parseFloat(String(row.get('Precio Supreme') || '0').replace(/[$,]/g, '')) || 0,
                Diesel: parseFloat(String(row.get('Precio Diesel') || '0').replace(/[$,]/g, '')) || 0
            }
        }));
        
        res.json(estaciones);
    } catch (error) {
        console.error("Error detallado en estaciones:", error);
        res.status(500).json({ error: "Error al cargar estaciones" });
    }
});
// 3. GUARDAR PEDIDO (Pestaña "Pedidos")
app.post('/api/pedidos', async (req, res) => {
    const pedido = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos']; 
        
        await sheet.addRow({
            'FECHA DE REGISTRO': new Date().toLocaleString(),
            'ESTACIÓN': pedido.estacion,
            'TIPO DE PRODUCTO': pedido.combustible,
            'LITROS': pedido.litros,
            'TOTAL': pedido.total,
            'FECHA DE ENTREGA': pedido.fecha_entrega,
            'PRIORIDAD': pedido.prioridad,
            'ESTATUS': 'Pendiente',
            'USUARIO': pedido.usuario
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error al guardar pedido:", error);
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));