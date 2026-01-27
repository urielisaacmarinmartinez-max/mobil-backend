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

// 2. CARGAR ESTACIONES (Ahora incluye datos de TIRILLAS)
app.get('/api/estaciones', async (req, res) => {
    try {
        await doc.loadInfo();
        const sheetEst = doc.sheetsByTitle['Estaciones']; 
        const sheetTirillas = doc.sheetsByTitle['TIRILLAS'];
        
        if (!sheetEst || !sheetTirillas) return res.status(404).json({ error: "Hojas no encontradas" });

        const rowsEst = await sheetEst.getRows();
        const rowsTir = await sheetTirillas.getRows();

        const estaciones = rowsEst.map(row => {
            const id = row.get('ID_Estacion') || '';
            // Buscamos los datos técnicos en la hoja de TIRILLAS
            const datosTirilla = rowsTir.find(t => t.get('ESTACION') === id);

            return {
                id: id,
                nombre: row.get('Nombre') || '',
                direccion: row.get('Dirección') || '',
                credito: parseFloat(String(row.get('Crédito Disponible') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
                precios: {
                    Extra: parseFloat(String(row.get('Precio Extra') || '0').replace(/[$,]/g, '')) || 0,
                    Supreme: parseFloat(String(row.get('Precio Supreme') || '0').replace(/[$,]/g, '')) || 0,
                    Diesel: parseFloat(String(row.get('Precio Diesel') || '0').replace(/[$,]/g, '')) || 0
                },
                // Datos de la hoja TIRILLAS
                capacidad: {
                    extra: datosTirilla?.get('CAP_EXTRA') || 0,
                    supreme: datosTirilla?.get('CAP_SUPREME') || 0,
                    diesel: datosTirilla?.get('CAP_DIESEL') || 0
                },
                ventaPromedio: {
                    extra: datosTirilla?.get('VTA_EXTRA') || 0,
                    supreme: datosTirilla?.get('VTA_SUPREME') || 0,
                    diesel: datosTirilla?.get('VTA_DIESEL') || 0
                },
                volumenActual: {
                    extra: datosTirilla?.get('VOL_EXTRA') || 0,
                    supreme: datosTirilla?.get('VOL_SUPREME') || 0,
                    diesel: datosTirilla?.get('VOL_DIESEL') || 0
                },
                ultimaActualizacion: datosTirilla?.get('ULTIMA_ACTUALIZACION') || 'Sin fecha'
            };
        });
        res.json(estaciones);
    } catch (error) {
        console.error("Error al cargar estaciones:", error);
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

// 4. OBTENER PEDIDOS (DASHBOARD)
app.get('/api/obtener-pedidos', async (req, res) => {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos'];
        const rows = await sheet.getRows();
        
        const pedidos = rows.reverse().slice(0, 6).map(row => ({
            fecha: row.get('FECHA DE REGISTRO'),
            estacion: row.get('ESTACIÓN'),
            producto: row.get('TIPO DE PRODUCTO'),
            litros: row.get('LITROS'),
            total: row.get('TOTAL'),
            estatus: row.get('ESTATUS') || 'Pendiente'
        }));

        const estadisticas = {
            pendientes: rows.filter(r => r.get('ESTATUS') === 'Pendiente').length,
            enRuta: rows.filter(r => r.get('ESTATUS') === 'En Ruta').length,
            entregados: rows.filter(r => r.get('ESTATUS') === 'Entregado').length // Nueva tercia
        };

        res.json({ pedidos, estadisticas });
    } catch (error) {
        res.status(500).json({ pedidos: [], estadisticas: { pendientes: 0, enRuta: 0, entregados: 0 } });
    }
});

// 5. NUEVA RUTA: ACTUALIZAR VOLUMEN EN HOJA TIRILLAS
app.post('/api/actualizar-tirilla', async (req, res) => {
    const { id_estacion, volExtra, volSupreme, volDiesel } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['TIRILLAS'];
        const rows = await sheet.getRows();
        
        const fila = rows.find(r => r.get('ESTACION') === id_estacion);
        
        if (fila) {
            fila.set('VOL_EXTRA', volExtra);
            fila.set('VOL_SUPREME', volSupreme);
            fila.set('VOL_DIESEL', volDiesel);
            // La fecha se actualiza vía App Script en Google Sheets o podemos ponerla aquí:
            fila.set('ULTIMA_ACTUALIZACION', new Date().toLocaleString());
            
            await fila.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Estación no encontrada en TIRILLAS" });
        }
    } catch (error) {
        console.error("Error al actualizar tirilla:", error);
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));