import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createRequire } from 'module';

// Esto permite seguir leyendo el JSON de credenciales en modo ESM
const require = createRequire(import.meta.url);
const keys = require('./google-auth.json');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// CONFIGURACIÓN DE GOOGLE SHEETS
const serviceAccountAuth = new JWT({
  email: keys.client_email,
  key: keys.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// REEMPLAZA ESTE ID CON EL TUYO REAL
const doc = new GoogleSpreadsheet('1GALSgq5RhFv103c307XYeNoorQ5gAzxFR1Q64XMGr7Q', serviceAccountAuth);

// RUTA DE LOGIN
// BUSCA ESTA SECCIÓN EN TU SERVER.JS Y REEMPLÁZALA:
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Usuarios']; 
        const rows = await sheet.getRows();
        
        // Buscamos al usuario ignorando filas vacías y asegurando que existan los datos
        const user = rows.find(r => {
            const rowEmail = r.get('email');
            const rowPass = r.get('password');
            
            return rowEmail && rowPass && 
                   rowEmail.toString().toLowerCase() === email.toLowerCase() && 
                   rowPass.toString() === password.toString();
        });
        
        if (user) {
            res.json({ 
                success: true, 
                user: {
                    nombre: user.get('nombre'),
                    rol: user.get('rol'),
                    estaciones: user.get('estaciones')
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Datos incorrectos' });
        }
    } catch (error) {
        console.error("Error en Login:", error);
        res.status(500).json({ success: false, message: 'Error de conexión' });
    }
});

// RUTA PARA OBTENER ESTACIONES
app.get('/api/estaciones', async (req, res) => {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Estaciones']; 
        const rows = await sheet.getRows();
        
        const estaciones = rows.map(row => ({
            id: row.get('id_estacion'),
            nombre: row.get('nombre_estacion'),
            direccion: row.get('direccion'),
            precios: {
                "Extra": parseFloat(row.get('precio_extra')) || 0,
                "Supreme": parseFloat(row.get('precio_supreme')) || 0,
                "Diesel": parseFloat(row.get('precio_diesel')) || 0
            },
            credito: parseFloat(row.get('credito_disponible')) || 0
        }));

        res.json(estaciones);
    } catch (error) {
        console.error("Error cargando estaciones:", error);
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));