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

// --- ESQUEMA COMPLETO (Sincronizado con nombres de Excel para evitar errores en Frontend) ---
const pedidoSchema = new mongoose.Schema({
    folio: { type: String, unique: true },
    'FECHA DE REGISTRO': String,
    'BLOQUE DE PROGRAMACIÓN': String,
    'ESTACIÓN': String,
    'TIPO DE PRODUCTO': String,
    'LITROS': Number,
    'TOTAL': String,
    'FECHA DE ENTREGA': String,
    'PRIORIDAD': String,
    'ESTATUS': String,
    'USUARIO': String,
    'ESTATUS DE CARGA': String,
    'CONFIRMACIÓN O REUBICACIÓN': String,
    'ORDEN RELACIONADA': String,
    'ORDEN': String,
    'FLETERA': String,
    'UNIDAD': String,
    'PLACA 1': String,
    'PLACA 2': String,
    'OPERADOR': String,
    'CANTIDAD EXACTA': String,
    'ETA': String,
    'FECHA DE DESCARGA': String,
    'TIPO DE OPERACIÓN': String,
    'FACTURA': String,
    'COMPRA': String,
    'CANCELACIÓN DE PEDIDO': String,
    'MOTIVO DE CANCELACIÓN': String,
    fechaRegistroDB: { type: Date, default: Date.now }
});
const Pedido = mongoose.model('Pedido', pedidoSchema);

const serviceAccountAuth = new JWT({
  email: keys.client_email,
  key: keys.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet('1GALSgq5RhFv103c307XYeNoorQ5gAzxFR1Q64XMGr7Q', serviceAccountAuth);

// --- FUNCIÓN DE SINCRONIZACIÓN INTEGRAL ---
async function sincronizarHojasAMongo() {
    try {
        const count = await Pedido.countDocuments();
        if (count === 0) {
            console.log('🔄 Iniciando migración completa de Google Sheets a MongoDB...');
            await doc.loadInfo();
            const sheet = doc.sheetsByTitle['Pedidos'];
            const rows = await sheet.getRows();
            
            const data = rows.map(r => ({
                folio: r.get('FOLIO'),
                'FECHA DE REGISTRO': r.get('FECHA DE REGISTRO'),
                'BLOQUE DE PROGRAMACIÓN': r.get('BLOQUE DE PROGRAMACIÓN'),
                'ESTACIÓN': r.get('ESTACIÓN'),
                'TIPO DE PRODUCTO': r.get('TIPO DE PRODUCTO'),
                'LITROS': Number(r.get('LITROS')) || 0,
                'TOTAL': r.get('TOTAL'),
                'FECHA DE ENTREGA': r.get('FECHA DE ENTREGA'),
                'PRIORIDAD': r.get('PRIORIDAD'),
                'ESTATUS': r.get('ESTATUS') || 'Pendiente',
                'USUARIO': r.get('USUARIO'),
                'ESTATUS DE CARGA': r.get('ESTATUS DE CARGA'),
                'CONFIRMACIÓN O REUBICACIÓN': r.get('CONFIRMACIÓN O REUBICACIÓN'),
                'ORDEN RELACIONADA': r.get('ORDEN RELACIONADA'),
                'ORDEN': r.get('ORDEN'),
                'FLETERA': r.get('FLETERA'),
                'UNIDAD': r.get('UNIDAD'),
                'PLACA 1': r.get('PLACA 1'),
                'PLACA 2': r.get('PLACA 2'),
                'OPERADOR': r.get('OPERADOR'),
                'CANTIDAD EXACTA': r.get('CANTIDAD EXACTA'),
                'ETA': r.get('ETA'),
                'FECHA DE DESCARGA': r.get('FECHA DE DESCARGA'),
                'TIPO DE OPERACIÓN': r.get('TIPO DE OPERACIÓN'),
                'FACTURA': r.get('FACTURA'),
                'COMPRA': r.get('COMPRA'),
                'CANCELACIÓN DE PEDIDO': r.get('CANCELACIÓN DE PEDIDO'),
                'MOTIVO DE CANCELACIÓN': r.get('MOTIVO DE CANCELACIÓN')
            }));

            if (data.length > 0) {
                await Pedido.insertMany(data);
                console.log(`✅ Migración exitosa: ${data.length} pedidos sincronizados.`);
            }
        }
    } catch (e) { 
        console.error("❌ Error en sincronización:", e); 
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
        if (fechaFiltro && fechaFiltro !== 'null' && fechaFiltro !== '') {
            query['BLOQUE DE PROGRAMACIÓN'] = fechaFiltro.trim();
        }

        if (rol !== 'Admin' && estaciones && estaciones !== 'TODAS') {
            const listaFiltro = estaciones.split(',').map(e => e.trim());
            if (rol === 'Fletera') {
                query['FLETERA'] = { $in: listaFiltro };
            } else {
                // El gerente filtra por nombre de estación
                query['ESTACIÓN'] = { $in: listaFiltro };
            }
        }

        const pedidos = await Pedido.find(query).sort({ fechaRegistroDB: -1 });

        // Función auxiliar para contar ignorando Mayúsculas/Minúsculas
        const contarPorEstatus = (lista, statusBuscado) => {
            return lista.filter(p => {
                const s = (p['ESTATUS'] || '').toUpperCase();
                if (statusBuscado === 'PENDIENTE') return s === 'PENDIENTE' || s === 'NUEVO';
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
        console.error("Error en obtener-pedidos:", error);
        res.status(500).json({ pedidos: [], estadisticas: { pendientes: 0, enRuta: 0, entregados: 0, programados: 0 } }); 
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