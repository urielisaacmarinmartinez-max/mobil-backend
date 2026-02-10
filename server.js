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
        const sheetEst = doc.sheetsByTitle['Estaciones']; 
        const sheetTirillas = doc.sheetsByTitle['TIRILLAS'];
        
        if (!sheetEst || !sheetTirillas) return res.status(404).json({ error: "Hojas no encontradas" });

        const rowsEst = await sheetEst.getRows();
        const rowsTir = await sheetTirillas.getRows();

        const estaciones = rowsEst.map(row => {
            const id = row.get('ID_Estacion') || '';
            const datosTirilla = rowsTir.find(t => t.get('ID_Estacion') === id);

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
                capacidad: {
                    extra: Number(datosTirilla?.get('CAP_EXTRA')) || 0,
                    supreme: Number(datosTirilla?.get('CAP_SUPREME')) || 0,
                    diesel: Number(datosTirilla?.get('CAP_DIESEL')) || 0
                },
                ventaPromedio: {
                    extra: Number(datosTirilla?.get('VTA_EXTRA')) || 0,
                    supreme: Number(datosTirilla?.get('VTA_SUPREME')) || 0,
                    diesel: Number(datosTirilla?.get('VTA_DIESEL')) || 0
                },
                volumenActual: {
                    extra: Number(datosTirilla?.get('VOL_EXTRA')) || 0,
                    supreme: Number(datosTirilla?.get('VOL_SUPREME')) || 0,
                    diesel: Number(datosTirilla?.get('VOL_DIESEL')) || 0
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
        
       
        const fechaFinal = pedido.fecha_registro || new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        await sheet.addRow({
            'FOLIO': pedido.folio,
            'FECHA DE REGISTRO': fechaFinal,
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
        console.error("Error al guardar en Sheets:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. OBTENER PEDIDOS (DASHBOARD)
app.get('/api/obtener-pedidos', async (req, res) => {
    const { estaciones, rol } = req.query; 
    try {
        await doc.loadInfo();
        const sheetPedidos = doc.sheetsByTitle['Pedidos'];
        const sheetEst = doc.sheetsByTitle['Estaciones'];
        
        const rowsPedidos = await sheetPedidos.getRows();
        const rowsEst = await sheetEst.getRows();

        let filasFiltradas = [];

        if (rol === 'Fletera') {
            filasFiltradas = rowsPedidos.filter(row => row.get('FLETERA') === estaciones);
        } else {
            const mapaNombres = {};
            rowsEst.forEach(r => { mapaNombres[r.get('ID_Estacion')] = r.get('Nombre'); });

            const idsPermitidos = estaciones ? estaciones.split(',').map(e => e.trim()) : [];
            const nombresPermitidos = idsPermitidos.map(id => mapaNombres[id]).filter(n => n);

            filasFiltradas = rowsPedidos.filter(row => {
                if (estaciones === 'TODAS') return true;
                return nombresPermitidos.includes(row.get('ESTACIÓN'));
            });
        }

        const pedidos = filasFiltradas.reverse().slice(0, 3).map(row => ({
            id: row.get('FOLIO'),
            fecha: row.get('FECHA DE REGISTRO'),
            estacion: row.get('ESTACIÓN'),
            producto: row.get('TIPO DE PRODUCTO'),
            litros: row.get('LITROS'),
            total: row.get('TOTAL'),
            estatus: row.get('ESTATUS') || 'Pendiente'
        }));

        const estadisticas = {
            pendientes: filasFiltradas.filter(r => r.get('ESTATUS') === 'Pendiente').length,
            enRuta: filasFiltradas.filter(r => r.get('ESTATUS') === 'En Ruta').length,
            entregados: filasFiltradas.filter(r => r.get('ESTATUS') === 'Entregado').length
        };

        res.json({ pedidos, estadisticas });
    } catch (error) {
        console.error("Error al obtener pedidos:", error);
        res.status(500).json({ pedidos: [], estadisticas: { pendientes: 0, enRuta: 0, entregados: 0 } });
    }
});

// 5. ACTUALIZAR VOLUMEN
app.post('/api/actualizar-tirilla', async (req, res) => {
    const { id_estacion, volExtra, volSupreme, volDiesel } = req.body;
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['TIRILLAS'];
        const rows = await sheet.getRows();
        const fila = rows.find(r => r.get('ID_Estacion') === id_estacion);
        
        if (fila) {
            fila.set('VOL_EXTRA', volExtra);
            fila.set('VOL_SUPREME', volSupreme);
            fila.set('VOL_DIESEL', volDiesel);
            // USAMOS LA MISMA LÓGICA DE TIEMPO PARA TIRILLAS DESDE EL SERVER
            fila.set('ULTIMA_ACTUALIZACION', new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }));
            
            await fila.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "Estación no encontrada" });
        }
    } catch (error) {
        console.error("Error al actualizar tirilla:", error);
        res.status(500).json({ success: false });
    }
});

// 6. OBTENER DETALLE
// Busca el app.get('/api/obtener-pedidos', ...) y actualízalo así:
app.get('/api/obtener-pedidos', async (req, res) => {
    // Recibimos 'fechaFiltro' desde el frontend
    const { estaciones, rol, fechaFiltro } = req.query; 
    try {
        await doc.loadInfo();
        const sheetPedidos = doc.sheetsByTitle['Pedidos'];
        const sheetEst = doc.sheetsByTitle['Estaciones'];
        
        const rowsPedidos = await sheetPedidos.getRows();
        const rowsEst = await sheetEst.getRows();

        let filasFiltradas = rowsPedidos;

        // --- FILTRO POR FECHA DE BLOQUE ---
        // En server.js, actualiza esta parte del filtro:
if (fechaFiltro) {
    filasFiltradas = filasFiltradas.filter(row => {
        // Obtenemos el valor de la Columna C (Bloque de Programación)
        const bloque = row.get('BLOQUE DE PROGRAMACIÓN');
        
        // Si la celda está vacía, la ignoramos
        if (!bloque) return false;

        // Limpiamos ambos valores para que la comparación sea exacta (texto simple)
        return bloque.toString().trim() === fechaFiltro.toString().trim();
    });
}

        // --- FILTRO POR ROL/ESTACIONES (Tu lógica existente) ---
        if (rol === 'Fletera') {
            filasFiltradas = filasFiltradas.filter(row => row.get('FLETERA') === estaciones);
        } else if (estaciones !== 'TODAS') {
            const mapaNombres = {};
            rowsEst.forEach(r => { mapaNombres[r.get('ID_Estacion')] = r.get('Nombre'); });
            const idsPermitidos = estaciones ? estaciones.split(',').map(e => e.trim()) : [];
            const nombresPermitidos = idsPermitidos.map(id => mapaNombres[id]).filter(n => n);

            filasFiltradas = filasFiltradas.filter(row => nombresPermitidos.includes(row.get('ESTACIÓN')));
        }

        // Mapeamos los datos para enviar al frontend
        const pedidos = filasFiltradas.reverse().map(row => ({
            id: row.get('FOLIO'),
            fecha: row.get('FECHA DE REGISTRO'),
            bloque: row.get('BLOQUE DE PROGRAMACIÓN'), // Importante para el contador
            estacion: row.get('ESTACIÓN'),
            producto: row.get('TIPO DE PRODUCTO'),
            litros: row.get('LITROS'),
            total: row.get('TOTAL'),
            estatus: row.get('ESTATUS') || 'Pendiente'
        }));

        // Estadísticas dinámicas según el filtro actual
        const estadisticas = {
            pendientes: filasFiltradas.filter(r => r.get('ESTATUS') === 'Pendiente').length,
            enRuta: filasFiltradas.filter(r => r.get('ESTATUS') === 'En Ruta').length,
            entregados: filasFiltradas.filter(r => r.get('ESTATUS') === 'Entregado').length,
            programados: filasFiltradas.filter(r => r.get('ESTATUS') === 'Aceptado').length
        };

        res.json({ pedidos, estadisticas });
    } catch (error) {
        console.error("Error al obtener pedidos:", error);
        res.status(500).json({ pedidos: [], estadisticas: { pendientes: 0, enRuta: 0, entregados: 0 } });
    }
});


// --- 7. LÓGICA DE REUBICACIÓN (SWAP) ---
app.post('/api/reubicar-pedido', async (req, res) => {
    const { folioOriginal, folioDestino, idOrden } = req.body;
    
    try {
        await doc.loadInfo();
        const sheetPedidos = doc.sheetsByTitle['Pedidos'];
        const sheetOrdenes = doc.sheetsByTitle['Ordenes de Carga'];
        
        const rowsP = await sheetPedidos.getRows();
        const rowsO = await sheetOrdenes.getRows();

        const pOriginal = rowsP.find(r => r.get('FOLIO') === folioOriginal);
        const pDestino = rowsP.find(r => r.get('FOLIO') === folioDestino);
        const ordenCarga = rowsO.find(r => r.get('ORDEN') === idOrden);

        if (pOriginal && pDestino) {
            // Transferir logística al nuevo pedido
            pDestino.set('FLETERA', pOriginal.get('FLETERA'));
            pDestino.set('UNIDAD', pOriginal.get('UNIDAD'));
            pDestino.set('PLACA 1', pOriginal.get('PLACA 1'));
            pDestino.set('PLACA 2', pOriginal.get('PLACA 2'));
            pDestino.set('OPERADOR', pOriginal.get('OPERADOR'));
            pDestino.set('ORDEN', idOrden);
            pDestino.set('ESTATUS', 'En Ruta');
            
            // "Limpiar" el original y regresarlo a pendiente
            pOriginal.set('ORDEN', '');
            pOriginal.set('FLETERA', '');
            pOriginal.set('UNIDAD', '');
            pOriginal.set('ESTATUS', 'Pendiente');
            pOriginal.set('CONFIRMACIÓN O REUBICACIÓN', `Carga reubicada al FOLIO: ${folioDestino}`);

            // Actualizar hoja de Órdenes
            if (ordenCarga) {
                ordenCarga.set('PEDIDO ACTUAL', folioDestino);
                ordenCarga.set('ESTATUS DE ORDEN', 'Reubicada');
            }

            await pDestino.save();
            await pOriginal.save();
            if (ordenCarga) await ordenCarga.save();

            res.json({ success: true });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- ENDPOINT PARA PROGRAMACIÓN POR BLOQUES (LOGÍSTICA) ---
// --- ACTUALIZADO: ENDPOINT PARA PROGRAMACIÓN POR BLOQUES (LOGÍSTICA) ---
app.post('/api/confirmar-bloque', async (req, res) => {
    // Aceptamos tanto idsPedidos como pedidos para evitar errores de integración
    const idsPedidos = req.body.idsPedidos || req.body.pedidos;
    const bloqueProgramacion = req.body.bloqueProgramacion || req.body.fechaProgramada;
    
    if (!idsPedidos || !bloqueProgramacion) {
        return res.status(400).json({ success: false, message: "Faltan datos (IDs o Fecha)" });
    }

    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['Pedidos'];
        const rows = await sheet.getRows();

        let procesados = 0;

        // Iteramos sobre los IDs recibidos
        for (let id of idsPedidos) {
            const row = rows.find(r => r.get('FOLIO').toString() === id.toString());
            if (row) {
                // Actualizamos la Columna C (BLOQUE DE PROGRAMACIÓN)
                row.set('BLOQUE DE PROGRAMACIÓN', bloqueProgramacion);
                
                // OPCIONAL: Si quieres que el estatus cambie, deja esta línea. 
                // Si quieres que se quede en 'Pendiente', coméntala.
                row.set('ESTATUS', 'Aceptado'); 
                
                await row.save();
                procesados++;
            }
        }

        res.json({ 
            success: true, 
            message: `Se programaron ${procesados} pedidos para el bloque ${bloqueProgramacion}` 
        });

    } catch (error) {
        console.error("Error en bloque:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));