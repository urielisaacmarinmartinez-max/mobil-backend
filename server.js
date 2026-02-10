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

// --- ESQUEMA COMPLETO (26 COLUMNAS) ---
const pedidoSchema = new mongoose.Schema({
    folio: { type: String, unique: true },
    fechaRegistro: String,           // FECHA DE REGISTRO
    bloque: String,                  // BLOQUE DE PROGRAMACIÓN
    estacion: String,                // ESTACIÓN
    producto: String,                // TIPO DE PRODUCTO
    litros: Number,                  // LITROS
    total: String,                   // TOTAL
    fechaEntrega: String,            // FECHA DE ENTREGA
    prioridad: String,               // PRIORIDAD
    estatus: String,                 // ESTATUS
    usuario: String,                 // USUARIO
    estatusCarga: String,            // ESTATUS DE CARGA
    confirmacionReubicacion: String, // CONFIRMACIÓN O REUBICACIÓN
    ordenRelacionada: String,        // ORDEN RELACIONADA
    orden: String,                   // ORDEN
    fletera: String,                 // FLETERA
    unidad: String,                  // UNIDAD
    placa1: String,                  // PLACA 1
    placa2: String,                  // PLACA 2
    operador: String,                // OPERADOR
    cantidadExacta: String,          // CANTIDAD EXACTA
    eta: String,                     // ETA
    fechaDescarga: String,           // FECHA DE DESCARGA
    tipoOperacion: String,           // TIPO DE OPERACIÓN
    factura: String,                 // FACTURA
    compra: String,                  // COMPRA
    cancelacionPedido: String,       // CANCELACIÓN DE PEDIDO
    motivoCancelacion: String,       // MOTIVO DE CANCELACIÓN
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
                fechaRegistro: r.get('FECHA DE REGISTRO'),
                bloque: r.get('BLOQUE DE PROGRAMACIÓN'),
                estacion: r.get('ESTACIÓN'),
                producto: r.get('TIPO DE PRODUCTO'),
                litros: Number(r.get('LITROS')) || 0,
                total: r.get('TOTAL'),
                fechaEntrega: r.get('FECHA DE ENTREGA'),
                prioridad: r.get('PRIORIDAD'),
                estatus: r.get('ESTATUS') || 'Pendiente',
                usuario: r.get('USUARIO'),
                estatusCarga: r.get('ESTATUS DE CARGA'),
                confirmacionReubicacion: r.get('CONFIRMACIÓN O REUBICACIÓN'),
                ordenRelacionada: r.get('ORDEN RELACIONADA'),
                orden: r.get('ORDEN'),
                fletera: r.get('FLETERA'),
                unidad: r.get('UNIDAD'),
                placa1: r.get('PLACA 1'),
                placa2: r.get('PLACA 2'),
                operador: r.get('OPERADOR'),
                cantidadExacta: r.get('CANTIDAD EXACTA'),
                eta: r.get('ETA'),
                fechaDescarga: r.get('FECHA DE DESCARGA'),
                tipoOperacion: r.get('TIPO DE OPERACIÓN'),
                factura: r.get('FACTURA'),
                compra: r.get('COMPRA'),
                cancelacionPedido: r.get('CANCELACIÓN DE PEDIDO'),
                motivoCancelacion: r.get('MOTIVO DE CANCELACIÓN')
            }));

            if (data.length > 0) {
                await Pedido.insertMany(data);
                console.log(`✅ Migración exitosa: ${data.length} pedidos con todas sus columnas.`);
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

// 3. GUARDAR PEDIDO (Actualizado con los campos de tu lista)
app.post('/api/pedidos', async (req, res) => {
    const p = req.body;
    const fechaMex = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    try {
        await Pedido.create({
            folio: p.folio,
            fechaRegistro: fechaMex,
            estacion: p.estacion,
            producto: p.combustible,
            litros: p.litros,
            total: p.total,
            fechaEntrega: p.fecha_entrega,
            prioridad: p.prioridad,
            estatus: 'Pendiente',
            usuario: p.usuario
        });

        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos'];
        await sheet.addRow({ 
            'FOLIO': p.folio, 
            'FECHA DE REGISTRO': fechaMex, 
            'ESTACIÓN': p.estacion, 
            'TIPO DE PRODUCTO': p.combustible, 
            'LITROS': p.litros, 
            'TOTAL': p.total, 
            'FECHA DE ENTREGA': p.fecha_entrega,
            'PRIORIDAD': p.prioridad,
            'ESTATUS': 'Pendiente',
            'USUARIO': p.usuario
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 4. OBTENER PEDIDOS
app.get('/api/obtener-pedidos', async (req, res) => {
    const { estaciones, rol, fechaFiltro } = req.query; 
    try {
        let query = {};
        if (fechaFiltro && fechaFiltro !== 'null') query.bloque = fechaFiltro.trim();

        if (rol !== 'Admin' && estaciones !== 'TODAS') {
            if (rol === 'Fletera') {
                query.fletera = estaciones;
            } else {
                const idsAsignados = estaciones.split(',').map(e => e.trim());
                query.$or = [
                    { estacion: { $in: idsAsignados } },
                    { estacion: { $regex: idsAsignados.join('|'), $options: 'i' } }
                ];
            }
        }

        const pedidos = await Pedido.find(query).sort({ fechaRegistroDB: -1 });

        res.json({ 
            pedidos, 
            estadisticas: {
                pendientes: pedidos.filter(p => p.estatus === 'Pendiente' || p.estatus === 'Nuevo').length,
                enRuta: pedidos.filter(p => p.estatus === 'En Ruta').length,
                entregados: pedidos.filter(p => p.estatus === 'Entregado').length,
                programados: pedidos.filter(p => p.estatus === 'Aceptado').length
            }
        });
    } catch (error) { res.status(500).json({ pedidos: [] }); }
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

// 7. REUBICAR (Actualizado para MongoDB)
app.post('/api/reubicar-pedido', async (req, res) => {
    const { folioOriginal, folioDestino, idOrden } = req.body;
    try {
        await Pedido.updateOne({ folio: folioOriginal }, { estatus: 'Pendiente', unidad: '', orden: '' });
        await Pedido.updateOne({ folio: folioDestino }, { estatus: 'En Ruta', orden: idOrden });

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

// 8. CONFIRMAR BLOQUE (Actualizado para MongoDB)
app.post('/api/confirmar-bloque', async (req, res) => {
    const ids = req.body.idsPedidos || req.body.pedidos;
    const bloque = req.body.bloqueProgramacion || req.body.fechaProgramada;
    try {
        await Pedido.updateMany({ folio: { $in: ids } }, { bloque: bloque, estatus: 'Aceptado' });
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