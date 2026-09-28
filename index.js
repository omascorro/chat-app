// Entrada de la app. Antes de expo-router:
// 1. el generador de numeros aleatorios (tweetnacl lo elige en cuanto se carga)
// 2. la tarea de notificaciones en segundo plano de Android: tiene que existir aunque la app arranque
//    sin pantalla (con la app cerrada, al llegar una notificacion)
import 'react-native-get-random-values';
import './src/lib/backgroundNotifications';
import 'expo-router/entry';
