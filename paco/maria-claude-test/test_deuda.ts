import { getDeudaTool } from './src/tools.js';

async function testGetDeuda() {
    console.log('🔍 Ejecutando función get_deuda para el contrato 123456...');
    console.log('📡 Realizando consulta SOAP al servicio web de gestión de deuda de CEA...\n');
    
    try {
        // Invocar la función interna del tool usando invoke
        const result = await getDeudaTool.invoke({ contrato: '123456' });
        console.log('✅ Resultado de get_deuda:');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ Error al ejecutar get_deuda:', error);
        if (error instanceof Error) {
            console.error('Detalles del error:', error.message);
        }
    }
}

testGetDeuda();
