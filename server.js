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

const doc = new GoogleSpreadsheet('1GALSgq5RhFv103c307XYeNoorQ5gAzxFR1Q64XMGr7Q', serviceAccountAuth);

// 1. LOGIN
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

// 2. CARGAR ESTACIONES
app.get('/api/estaciones', async (req, res) => {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Estaciones']; 
        if (!sheet) return res.status(404).json({ error: "Hoja no encontrada" });

        const rows = await sheet.getRows();
        const estaciones = rows.map(row => ({
            id: row.get('ID_Estacion') || '',
            nombre: row.get('Nombre') || '',
            direccion: row.get('Dirección') || '',
            credito: parseFloat(String(row.get('Crédito Disponible') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
            precios: {
                Extra: parseFloat(String(row.get('Precio Extra') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
                Supreme: parseFloat(String(row.get('Precio Supreme') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
                Diesel: parseFloat(String(row.get('Precio Diesel') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0
            }
        }));
        res.json(estaciones);
    } catch (error) {
        res.status(500).json({ error: "Error al cargar estaciones" });
    }
});

// 3. GUARDAR PEDIDO
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
        res.status(500).json({ success: false });
    }
});

// 4. OBTENER PEDIDOS (NUEVA RUTA PARA EL DASHBOARD)
app.get('/api/obtener-pedidos', async (req, res) => {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos'];
        const rows = await sheet.getRows();
        
        // Invertimos el orden para que los más nuevos salgan primero y tomamos 6
        const pedidos = rows.reverse().slice(0, 6).map(row => ({
            fecha: row.get('FECHA DE REGISTRO'),
            estacion: row.get('ESTACIÓN'),
            producto: row.get('TIPO DE PRODUCTO'),
            litros: row.get('LITROS'),
            total: row.get('TOTAL'),
            estatus: row.get('ESTATUS') || 'Pendiente'
        }));

        // Contadores para los cuadritos del Dashboard
        const estadisticas = {
            pendientes: rows.filter(r => r.get('ESTATUS') === 'Pendiente').length,
            enRuta: rows.filter(r => r.get('ESTATUS') === 'En Ruta').length
        };

        res.json({ pedidos, estadisticas });
    } catch (error) {
        console.error("Error al leer pedidos:", error);
        res.status(500).json({ pedidos: [], estadisticas: { pendientes: 0, enRuta: 0 } });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));