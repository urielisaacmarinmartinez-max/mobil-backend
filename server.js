import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { createRequire } from 'module';
import mongoose from 'mongoose';

const require = createRequire(import.meta.url);
const keys = require('./google-auth.json');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- CONEXIÓN MONGODB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
      console.log('✅ Conectado a MongoDB Atlas');
      sincronizarHojasAMongo();
  })
  .catch(err => console.error('❌ Error conexión Mongo:', err));

// --- ESQUEMA HÍBRIDO (Mantiene compatibilidad con Excel y MongoDB Atlas) ---
const pedidoSchema = new mongoose.Schema({
    folio: { type: String, unique: true },
    // Definimos las llaves en minúsculas que ya existen en tu MongoDB Atlas
    estacion: String,
    producto: String,
    litros: Number,
    total: String,
    estatus: String,
    bloque: String,
    fletera: String,
    unidad: String,
    orden: String,
    // Mantenemos estas por si el Excel las envía con nombres largos
    'FECHA DE REGISTRO': String,
    'BLOQUE DE PROGRAMACIÓN': String,
    'ESTACIÓN': String,
    'TIPO DE PRODUCTO': String,
    'ESTATUS': String,
    fechaRegistroDB: { type: Date, default: Date.now }
}, { 
    strict: false, // ¡ESTO ES VITAL! Permite leer cualquier campo aunque no esté aquí
    collection: 'pedidos' 
});

const Pedido = mongoose.model('Pedido', pedidoSchema);

const serviceAccountAuth = new JWT({
  email: keys.client_email,
  key: keys.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet('1GALSgq5RhFv103c307XYeNoorQ5gAzxFR1Q64XMGr7Q', serviceAccountAuth);

// --- FUNCIÓN DE SINCRONIZACIÓN INTEGRAL REPARADA ---
async function sincronizarHojasAMongo() {
    try {
        const count = await Pedido.countDocuments();
        if (count === 0) {
            console.log('🔄 MongoDB vacío. Iniciando migración integral...');
            await doc.loadInfo();
            const sheet = doc.sheetsByTitle['Pedidos'];
            const rows = await sheet.getRows();
            
            // Esto detecta automáticamente TODAS tus columnas (FOLIO, FECHA, PLACA 1, OPERADOR, etc.)
            const headers = sheet.headerValues;

            const data = rows.map(r => {
                const rowObj = {};
                
                // 1. MAPEADO AUTOMÁTICO: Captura cada columna del Excel sin excepciones
                headers.forEach(h => {
                    rowObj[h] = r.get(h);
                });

                // 2. COMPATIBILIDAD: Creamos "alias" en minúsculas para que tus filtros actuales no se rompan
                rowObj.folio = r.get('FOLIO');
                rowObj.estacion = r.get('ESTACIÓN');
                rowObj.estatus = r.get('ESTATUS') || 'Pendiente';
                rowObj.bloque = r.get('BLOQUE DE PROGRAMACIÓN');
                rowObj.fletera = r.get('FLETERA');
                rowObj.unidad = r.get('UNIDAD');
                
                return rowObj;
            });

            if (data.length > 0) {
                await Pedido.insertMany(data);
                console.log(`✅ ¡Sincronización completa! ${data.length} pedidos guardados con todas sus columnas.`);
            }
        }
    } catch (e) {
        console.error("❌ Error en la sincronización:", e);
    }
}
// 1. LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Usuarios']; 
        const rows = await sheet.getRows();
        const user = rows.find(r => r.get('EMAIL')?.toLowerCase() === email.toLowerCase() && r.get('PASSWORD')?.toString() === password.toString());
        if (user) {
            res.json({ success: true, user: { nombre: user.get('NOMBRE'), rol: user.get('ROL'), estaciones: user.get('ESTACIONES') } });
        } else {
            res.status(401).json({ success: false, message: 'Datos incorrectos' });
        }
    } catch (error) { res.status(500).json({ success: false }); }
});

// 2. CARGAR ESTACIONES
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
            const datosTirilla = rowsTir.find(t => t.get('ID_Estacion') === id);
            return {
                id,
                nombre: row.get('Nombre') || '',
                direccion: row.get('Dirección') || '',
                credito: parseFloat(String(row.get('Crédito Disponible') || '0').replace(/[$,]/g, '').replace(/,/g, '')) || 0,
                precios: {
                    Extra: parseFloat(String(row.get('Precio Extra') || '0').replace(/[$,]/g, '')) || 0,
                    Supreme: parseFloat(String(row.get('Precio Supreme') || '0').replace(/[$,]/g, '')) || 0,
                    Diesel: parseFloat(String(row.get('Precio Diesel') || '0').replace(/[$,]/g, '')) || 0
                },
                capacidad: { extra: Number(datosTirilla?.get('CAP_EXTRA')) || 0, supreme: Number(datosTirilla?.get('CAP_SUPREME')) || 0, diesel: Number(datosTirilla?.get('CAP_DIESEL')) || 0 },
                volumenActual: { extra: Number(datosTirilla?.get('VOL_EXTRA')) || 0, supreme: Number(datosTirilla?.get('VOL_SUPREME')) || 0, diesel: Number(datosTirilla?.get('VOL_DIESEL')) || 0 },
                ultimaActualizacion: datosTirilla?.get('ULTIMA_ACTUALIZACION') || 'Sin fecha'
            };
        });
        res.json(estaciones);
    } catch (error) { res.status(500).json({ error: "Error" }); }
});

// 3. GUARDAR PEDIDO
app.post('/api/pedidos', async (req, res) => {
    const p = req.body;
    const fechaMex = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    try {
        const nuevoPedido = {
            folio: p.folio,
            'FECHA DE REGISTRO': fechaMex,
            'ESTACIÓN': p.estacion,
            'TIPO DE PRODUCTO': p.combustible,
            'LITROS': p.litros,
            'TOTAL': p.total,
            'FECHA DE ENTREGA': p.fecha_entrega,
            'PRIORIDAD': p.prioridad,
            'ESTATUS': 'Pendiente',
            'USUARIO': p.usuario
        };
        
        await Pedido.create(nuevoPedido);

        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos'];
        await sheet.addRow(nuevoPedido);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 4. OBTENER PEDIDOS (Corregido para Gerentes y Admin)
app.get('/api/obtener-pedidos', async (req, res) => {
    const { estaciones, rol, fechaFiltro } = req.query; 
    try {
        let query = {};

        // 1. Filtro por Bloque (Usando la llave que vimos en tu Atlas)
        if (fechaFiltro && fechaFiltro !== 'null' && fechaFiltro !== '') {
            query['bloque'] = fechaFiltro.trim();
        }

        // 2. Filtro por Rol y Estación
        if (rol !== 'Admin' && rol !== 'Logistica_Policon' && estaciones && estaciones !== 'TODAS') {
            const listaFiltro = estaciones.split(',').map(e => e.trim());
            
            if (rol === 'Fletera') {
                query['fletera'] = { $in: listaFiltro };
            } else {
                // Filtro para Gerentes: Busca en la columna 'estacion' (minúsculas)
                query['estacion'] = { $in: listaFiltro };
            }
        }

        const pedidos = await Pedido.find(query).sort({ fechaRegistroDB: -1 });

        // 3. Función de conteo ajustada a la realidad de tus datos
        const contarPorEstatus = (lista, statusBuscado) => {
            return lista.filter(p => {
                const s = (p.estatus || '').toUpperCase();
                if (statusBuscado === 'PENDIENTE') return s === 'PENDIENTE' || s === 'NUEVO' || s === '';
                return s === statusBuscado;
            }).length;
        };

        res.json({ 
            pedidos, 
            estadisticas: {
                pendientes: contarPorEstatus(pedidos, 'PENDIENTE'),
                enRuta: contarPorEstatus(pedidos, 'EN RUTA'),
                entregados: contarPorEstatus(pedidos, 'ENTREGADO'),
                programados: contarPorEstatus(pedidos, 'ACEPTADO')
            }
        });
    } catch (error) { 
        console.error("❌ Error:", error);
        res.status(500).json({ pedidos: [] }); 
    }
});

// 5. ACTUALIZAR TIRILLA
app.post('/api/actualizar-tirilla', async (req, res) => {
    const { id_estacion, volExtra, volSupreme, volDiesel } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['TIRILLAS'];
        const rows = await sheet.getRows();
        const fila = rows.find(r => r.get('ID_Estacion') === id_estacion);
        if (fila) {
            fila.set('VOL_EXTRA', volExtra); fila.set('VOL_SUPREME', volSupreme); fila.set('VOL_DIESEL', volDiesel);
            fila.set('ULTIMA_ACTUALIZACION', new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }));
            await fila.save();
            res.json({ success: true });
        }
    } catch (error) { res.status(500).json({ success: false }); }
});

// 7. REUBICAR
app.post('/api/reubicar-pedido', async (req, res) => {
    const { folioOriginal, folioDestino, idOrden } = req.body;
    try {
        await Pedido.updateOne({ folio: folioOriginal }, { 'ESTATUS': 'Pendiente', 'UNIDAD': '', 'ORDEN': '' });
        await Pedido.updateOne({ folio: folioDestino }, { 'ESTATUS': 'En Ruta', 'ORDEN': idOrden });

        await doc.loadInfo();
        const rowsP = await doc.sheetsByTitle['Pedidos'].getRows();
        const pOriginal = rowsP.find(r => r.get('FOLIO') === folioOriginal);
        const pDestino = rowsP.find(r => r.get('FOLIO') === folioDestino);
        if (pOriginal && pDestino) {
            pDestino.set('ESTATUS', 'En Ruta'); pDestino.set('ORDEN', idOrden);
            pOriginal.set('ESTATUS', 'Pendiente'); pOriginal.set('ORDEN', '');
            await pDestino.save(); await pOriginal.save();
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 8. CONFIRMAR BLOQUE
app.post('/api/confirmar-bloque', async (req, res) => {
    const ids = req.body.idsPedidos || req.body.pedidos;
    const bloque = req.body.bloqueProgramacion || req.body.fechaProgramada;
    try {
        await Pedido.updateMany({ folio: { $in: ids } }, { 'BLOQUE DE PROGRAMACIÓN': bloque, 'ESTATUS': 'Aceptado' });
        await doc.loadInfo();
        const rows = await doc.sheetsByTitle['Pedidos'].getRows();
        for (let id of ids) {
            const row = rows.find(r => r.get('FOLIO') === id.toString());
            if (row) { row.set('BLOQUE DE PROGRAMACIÓN', bloque); row.set('ESTATUS', 'Aceptado'); await row.save(); }
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => console.log(`🚀 Servidor Híbrido Activo en puerto ${PORT}`));
