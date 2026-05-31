import asyncio
import json
import websockets

# Guarda las conexiones de los jugadores activos
PLAYERS = {}

async def handler(websocket):
    global PLAYERS
    
    # Máximo 2 jugadores por partida
    if len(PLAYERS) >= 2:
        await websocket.send(json.dumps({"type": "error", "message": "La partida está llena"}))
        await websocket.close()
        return

    # Asignar color disponible
    color = "W" if "W" not in PLAYERS else "B"
    PLAYERS[color] = websocket
    print(f"Jugador conectado como: {color}")

    try:
        # Enviar al cliente el color asignado
        await websocket.send(json.dumps({"type": "init", "color": color}))

        # Cuando se completan los 2, se inicia el juego
        if len(PLAYERS) == 2:
            websockets.broadcast(PLAYERS.values(), json.dumps({"type": "start"}))

        # Escuchar las acciones de este jugador
        async for message in websocket:
            data = json.loads(message)
            
            if data["type"] == "move":
                # Retransmitir la jugada al oponente
                for p_color, p_ws in PLAYERS.items():
                    if p_color != color:
                        await p_ws.send(json.dumps({
                            "type": "move",
                            "fromRow": data["fromRow"],
                            "fromCol": data["fromCol"],
                            "toRow": data["toRow"],
                            "toCol": data["toCol"]
                        }))
            
            elif data["type"] == "restart":
                # Retransmitir orden de reinicio general
                websockets.broadcast(PLAYERS.values(), json.dumps({"type": "restart"}))
                        
    except websockets.ConnectionClosed:
        print(f"Jugador {color} abandonó la sesión.")
    finally:
        if color in PLAYERS:
            del PLAYERS[color]
        # Notificar al que quedó solo que se cancela la partida
        if len(PLAYERS) < 2:
            websockets.broadcast(PLAYERS.values(), json.dumps({"type": "opponent_left"}))

async def main():
    # Escucha en el puerto 8080 para conexiones locales
    async with websockets.serve(handler, "0.0.0.0", 8080):
        print("Servidor de Ajedrez activo en el puerto 8080...")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())