// ====== SELECCIÓN DE ELEMENTOS DEL DOM (INTERFAZ GRÁFICA) ======
const boardElement = document.getElementById('chessboard'); 
const wrapper = document.querySelector('.board-wrapper'); 
const turnIndicator = document.getElementById('turn-indicator'); 
const eloWhite = document.getElementById('elo-white'); 
const eloBlack = document.getElementById('elo-black'); 
const movesLog = document.getElementById('moves-log'); 
const gamesHistoryLog = document.getElementById('games-history-log'); 

const drawBtn = document.getElementById('draw-btn'); 
const resignBtn = document.getElementById('resign-btn'); 
const clearHistoryBtn = document.getElementById('clear-history-btn');
const rematchBtn = document.getElementById('rematch-btn'); 
const notificationOverlay = document.getElementById('notification-overlay');
const notificationTitle = document.getElementById('notification-title');
const notificationMessage = document.getElementById('notification-message');
const notificationMark = document.querySelector('.notification-mark');
const notificationAccept = document.getElementById('notification-accept');
const notificationReject = document.getElementById('notification-reject');
const colorSelector = document.getElementById('color-selector');
const clockWhite = document.getElementById('clock-white');
const clockBlack = document.getElementById('clock-black');
const resultWhite = document.getElementById('result-white');
const resultBlack = document.getElementById('result-black');
const spectatorNote = document.getElementById('spectator-note');

let notificationQueue = Promise.resolve();

function showNotification({ title, message, acceptText = 'Entendido', rejectText = null, tone = 'info', icon = '♟' }) {
    const pendingNotification = notificationQueue.then(() => new Promise(resolve => {
        notificationTitle.textContent = title;
        notificationMessage.textContent = message;
        notificationMark.textContent = icon;
        notificationAccept.textContent = acceptText;
        notificationReject.textContent = rejectText || 'Rechazar';
        notificationReject.hidden = !rejectText;
        notificationOverlay.dataset.tone = tone;
        notificationOverlay.hidden = false;

        const finish = accepted => {
            notificationOverlay.hidden = true;
            notificationAccept.removeEventListener('click', accept);
            notificationReject.removeEventListener('click', reject);
            document.removeEventListener('keydown', handleKeydown);
            resolve(accepted);
        };
        const accept = () => finish(true);
        const reject = () => finish(false);
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(rejectText ? false : true);
        };

        notificationAccept.addEventListener('click', accept);
        notificationReject.addEventListener('click', reject);
        document.addEventListener('keydown', handleKeydown);
        notificationAccept.focus();
    }));

    notificationQueue = pendingNotification.then(() => undefined, () => undefined);
    return pendingNotification;
}

// ====== CONFIGURACIÓN Y ESTADO DE LA RED (WEBSOCKET) ======
const roomParameters = new URLSearchParams(window.location.search);
const roomId = roomParameters.get('room');
const roomMode = roomParameters.get('modern') === '1' && Boolean(roomId);
const socketUrl = roomMode
    ? `wss://ajedrez-backend-fyjz.onrender.com/?modern=1&room=${encodeURIComponent(roomId)}`
    : 'wss://ajedrez-backend-fyjz.onrender.com';
const socket = new WebSocket(socketUrl);

// ====== VARIABLES DE ESTADO GLOBAL DEL JUEGO ======
let miColor = null; 
let partidaIniciada = false; 
let currentTurn = 'W'; 
let selectedSquare = null; 
let validMoves = []; 
let isGameOver = false; 
let isSpectator = false;
let resultNotificationShown = false;
let roomClock = { W: 600, B: 600, turn: 'W', running: false, receivedAt: 0 };

let currentGameMoves = []; 
let matchHistory = JSON.parse(localStorage.getItem('chess_match_history')) || [];
let eloBlancas = parseInt(localStorage.getItem('elo_blancas')) || 1000;
let eloNegras = parseInt(localStorage.getItem('elo_negras')) || 1000;
const FACTOR_K = 20; 

let movedPieces = {
    'W_king': false, 'W_rook_a': false, 'W_rook_h': false, 
    'B_king': false, 'B_rook_a': false, 'B_rook_h': false  
};

// ====== MATRIZ DE ESTADO DEL TABLERO ======
let boardState = [
    ['t', 'c', 'a', 'q', 'k', 'a', 'c', 't'], 
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'], 
    ['',  '',  '',  '',  '',  '',  '',  ''],  
    ['',  '',  '',  '',  '',  '',  '',  ''],  
    ['',  '',  '',  '',  '',  '',  '',  ''],  
    ['',  '',  '',  '',  '',  '',  '',  ''],  
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
    ['T', 'C', 'A', 'Q', 'K', 'A', 'C', 'T']  
];

const unicodePieces = {
    't': '♜', 'c': '♞', 'a': '♝', 'q': '♛', 'k': '♚', 'p': '♟', 
    'T': '♜', 'C': '♞', 'A': '♝', 'Q': '♛', 'K': '♚', 'P': '♟', 
    '': '' 
};

// ====== HEARTBEAT (PING) ======
function iniciarPingAutomatico() {
    setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
        }
    }, 30000); 
}

// ====== CONTROLADORES DE EVENTOS WEBSOCKET ======
socket.onopen = function() {
    turnIndicator.innerText = "Conectado. Buscando oponente..."; 
    turnIndicator.style.backgroundColor = '#1e3a8a'; 
    iniciarPingAutomatico(); 
};

socket.onmessage = async function(event) {
    const data = JSON.parse(event.data); 

    if (data.type === 'pong') return; 

    if (data.type === 'init') { 
        if (data.spectator) {
            isSpectator = true;
            miColor = null;
            resetTableroLocal();
            if (colorSelector) colorSelector.hidden = true;
            if (spectatorNote) spectatorNote.hidden = false;
            resignBtn.disabled = true;
            drawBtn.disabled = true;
            if (rematchBtn) rematchBtn.disabled = true;
            data.moves.forEach(move => executeMove(
                move.fromRow,
                move.fromCol,
                move.toRow,
                move.toCol,
                false,
                move.promotedPiece || null
            ));
            currentTurn = data.turn || currentTurn;
            roomClock = {
                W: data.clocks.W,
                B: data.clocks.B,
                turn: data.turn,
                running: data.running,
                receivedAt: performance.now()
            };
            renderPlayerClocks();
            isGameOver = data.gameOver;
            partidaIniciada = false;
            turnIndicator.innerText = data.gameOver
                ? `Modo espectador · Partida finalizada${data.winner ? `. Ganaron las ${data.winner === 'W' ? 'Blancas' : 'Negras'}` : '.'}`
                : data.running ? 'Modo espectador · Partida en curso' : 'Modo espectador · Esperando inicio';
            if (data.gameOver && data.winner) showGameResultNotification(data.winner, data.endReason);
            drawBoard();
            return;
        }
        if (data.needsColor) {
            if (colorSelector) colorSelector.hidden = false;
            turnIndicator.innerText = 'Elige con qué piezas quieres jugar.';
            turnIndicator.style.backgroundColor = '#1e3a8a';
            return;
        }
        if (data.waitingForColor) {
            turnIndicator.innerText = 'Esperando que el otro jugador elija piezas...';
            turnIndicator.style.backgroundColor = '#1e3a8a';
            return;
        }
        miColor = data.color;
        if (colorSelector) colorSelector.hidden = true;
        turnIndicator.innerText = `Eres las ${miColor === 'W' ? 'Blancas ⬜' : 'Negras ⬛'}. Esperando rival...`;
        turnIndicator.style.backgroundColor = '#1e3a8a'; 
        resetTableroLocal(); 
        drawBoard(); 
    }
    if (data.type === 'start') { 
        if (isSpectator) {
            resetTableroLocal();
            isGameOver = false;
            resultNotificationShown = false;
            partidaIniciada = false;
            resignBtn.disabled = true;
            drawBtn.disabled = true;
            if (rematchBtn) rematchBtn.disabled = true;
            turnIndicator.innerText = 'Modo espectador · Nueva partida en curso';
            drawBoard();
            return;
        }
        partidaIniciada = true; 
        isGameOver = false; 
        resultNotificationShown = false;
        clearPlayerResults();
        resignBtn.disabled = false; 
        drawBtn.disabled = false; 
        actualizarBannerTurno(); 
        drawBoard(); 
    }
    if (data.type === 'move') { 
        executeMove(data.fromRow, data.fromCol, data.toRow, data.toCol, false, data.promotedPiece || null);
    }

    if (data.type === 'clocks') {
        roomClock = {
            W: data.clocks.W,
            B: data.clocks.B,
            turn: data.turn,
            running: data.running,
            receivedAt: performance.now()
        };
        renderPlayerClocks();
    }

    if (data.type === 'game_over') {
        finishRoomGame(data.winner, data.reason);
    }

    // RECEPCIÓN DE RENDICIÓN
    if (data.type === 'resign') { 
        const colorRendido = data.color || data.colorQueAbandona;
        if (isSpectator) {
            finishRoomGame(colorRendido === 'W' ? 'B' : 'W', 'resign');
            return;
        }
        finalizarPorRendicion(colorRendido); 
    }

    // RECEPCIÓN DE OFERTA DE TABLAS
    if (data.type === 'offer_draw') { 
        if (isSpectator) return;
        const solicitante = data.sender || data.color;
        recibirOfertaTablas(solicitante); 
    }

    // RECEPCIÓN DE TABLAS ACEPTADAS
    if (data.type === 'accept_draw') { 
        await showNotification({ title: 'Tablas aceptadas', message: 'La partida terminó en empate.' });
        finalizarPorTablas(); 
    }

    // RECEPCIÓN DE PROPUESTA DE REVANCHA
    if (data.type === 'rematch_offered') {
        if (isSpectator) return;
        const textoRival = data.senderColor === 'W' ? 'Blancas' : 'Negras';
        if (await showNotification({ title: 'Propuesta de revancha', message: `El jugador de las ${textoRival} te ofrece una revancha.`, acceptText: 'Aceptar revancha', rejectText: 'Ahora no', tone: 'decision' })) {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'accept_rematch' }));
            }
        }
    }
    
    if (data.type === 'opponent_left') { 
        if (isSpectator) {
            turnIndicator.innerText = 'Modo espectador · Un jugador se desconectó.';
            return;
        }
        partidaIniciada = false; 
        resignBtn.disabled = true; 
        drawBtn.disabled = true; 
        turnIndicator.innerText = "El rival abandonó la sala."; 
        turnIndicator.style.backgroundColor = '#b45309'; 
    }
    if (data.type === 'error') { 
        showNotification({ title: 'Aviso de conexión', message: data.message });
    }
};

socket.onerror = function() {
    turnIndicator.innerText = "Modo Local / Conectando..."; 
    turnIndicator.style.backgroundColor = '#b91c1c'; 
};

socket.onclose = function() {
    turnIndicator.innerText = "Desconectado. Reintentando..."; 
    turnIndicator.style.backgroundColor = '#b91c1c'; 
};

document.querySelectorAll('.color-choice').forEach(button => {
    button.addEventListener('click', () => {
        if (!roomMode || socket.readyState !== WebSocket.OPEN) return;
        document.querySelectorAll('.color-choice').forEach(choice => choice.disabled = true);
        socket.send(JSON.stringify({ type: 'choose_color', color: button.dataset.color }));
    });
});

setInterval(renderPlayerClocks, 250);

function renderPlayerClocks() {
    if (!roomMode || !clockWhite || !clockBlack) return;
    const elapsed = roomClock.running ? (performance.now() - roomClock.receivedAt) / 1000 : 0;
    const whiteSeconds = Math.max(0, roomClock.W - (roomClock.turn === 'W' ? elapsed : 0));
    const blackSeconds = Math.max(0, roomClock.B - (roomClock.turn === 'B' ? elapsed : 0));
    clockWhite.textContent = formatClock(whiteSeconds);
    clockBlack.textContent = formatClock(blackSeconds);
    clockWhite.classList.toggle('active', roomClock.running && roomClock.turn === 'W');
    clockBlack.classList.toggle('active', roomClock.running && roomClock.turn === 'B');
}

function formatClock(seconds) {
    const wholeSeconds = Math.ceil(seconds);
    return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

function clearPlayerResults() {
    [resultWhite, resultBlack].forEach(result => {
        if (!result) return;
        result.hidden = true;
        result.textContent = '';
        result.classList.remove('winner', 'loser');
    });
}

function showPlayerResults(winner) {
    if (!roomMode || !resultWhite || !resultBlack || !winner) return;
    const entries = [{ color: 'W', element: resultWhite }, { color: 'B', element: resultBlack }];
    entries.forEach(({ color, element }) => {
        element.hidden = false;
        element.classList.toggle('winner', color === winner);
        element.classList.toggle('loser', color !== winner);
        element.textContent = color === winner ? '🏆 ¡Ganador!' : 'Perdió';
    });
}

function showGameResultNotification(winner, reason) {
    if (!winner || resultNotificationShown) return;
    resultNotificationShown = true;
    const winnerName = winner === 'W' ? 'Blancas' : 'Negras';
    const loserName = winner === 'W' ? 'Negras' : 'Blancas';
    const ending = reason === 'timeout' ? ' por tiempo' : reason === 'resign' ? ' por rendición' : reason === 'checkmate' ? ' por jaque mate' : '';
    showNotification({
        title: '¡Ganador!',
        message: `Las ${winnerName} ganan${ending}. Las ${loserName} perdieron.`,
        acceptText: 'Cerrar',
        tone: 'result',
        icon: '🏆'
    });
}

function finishRoomGame(winner, reason) {
    if (!roomMode) return;
    isGameOver = true;
    partidaIniciada = false;
    resignBtn.disabled = true;
    drawBtn.disabled = true;
    roomClock.running = false;
    showGameResultNotification(winner, reason);
    if (isSpectator && winner) {
        turnIndicator.innerText = `Modo espectador · Ganaron las ${winner === 'W' ? 'Blancas' : 'Negras'}`;
        turnIndicator.style.backgroundColor = '#4b5563';
    } else if (winner) {
        turnIndicator.innerText = winner === miColor ? '¡Ganaste la partida!' : 'Partida finalizada. Ganó tu oponente.';
        turnIndicator.style.backgroundColor = winner === miColor ? '#47a047' : '#b91c1c';
    } else if (reason === 'draw') {
        turnIndicator.innerText = '🤝 Tablas - Empate Acordado';
        turnIndicator.style.backgroundColor = '#4b5563';
    } else if (reason === 'timeout') {
        turnIndicator.innerText = 'Partida finalizada por tiempo agotado.';
        turnIndicator.style.backgroundColor = '#b91c1c';
    }
    selectedSquare = null;
    validMoves = [];
    drawBoard();
}

function sendRoomGameOver(winner, reason) {
    if (roomMode && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'game_over', winner, reason }));
    }
}

// ====== MANIPULACIÓN DE BOTONES DE ACCIÓN GRÁFICA ======
resignBtn.addEventListener('click', () => {
    if (!partidaIniciada || isGameOver) return; 
    
    showNotification({ title: 'Rendirse', message: '¿Estás seguro de que quieres rendirte?', acceptText: 'Sí, rendirme', rejectText: 'Continuar jugando', tone: 'decision' }).then(accepted => {
        if (!accepted) return;
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resign", color: miColor, colorQueAbandona: miColor })); 
        }
        finalizarPorRendicion(miColor); 
    });
});

drawBtn.addEventListener('click', () => {
    if (!partidaIniciada || isGameOver) return; 
    
    showNotification({ title: 'Oferta enviada', message: 'Tu rival recibió la oferta de tablas. Esperando respuesta.' });
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "offer_draw", sender: miColor, color: miColor })); 
    }
});

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        showNotification({ title: 'Borrar historial', message: '¿Seguro que deseas borrar todas las partidas guardadas?', acceptText: 'Borrar historial', rejectText: 'Cancelar', tone: 'decision' }).then(accepted => {
            if (!accepted) return;
            localStorage.removeItem('chess_match_history');
            matchHistory = [];
            renderHistoryLog();
            showNotification({ title: 'Historial borrado', message: 'Se eliminaron las partidas guardadas.' });
        });
    });
}

if (rematchBtn) {
    rematchBtn.addEventListener('click', () => {
        if (!isGameOver) {
            showNotification({ title: 'Partida en curso', message: 'La revancha estará disponible cuando termine la partida.' });
            return;
        }
        showNotification({ title: 'Propuesta enviada', message: 'Tu rival recibió la solicitud de revancha. Esperando respuesta.' });
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'request_rematch', senderColor: miColor }));
        }
    });
}

// ====== LÓGICA DE CIERRE DE PARTIDAS ======
function finalizarPorRendicion(colorQueAbandona) {
    isGameOver = true;          
    partidaIniciada = false; 
    resignBtn.disabled = true; 
    drawBtn.disabled = true; 
    
    const ganadorText = colorQueAbandona === 'W' ? 'Negras ⬛' : 'Blancas ⬜'; 
    turnIndicator.innerHTML = `🏳️ Partida finalizada. Ganan las ${ganadorText}`; 
    turnIndicator.style.backgroundColor = '#b91c1c'; 
    showGameResultNotification(colorQueAbandona === 'W' ? 'B' : 'W', 'resign');
    
    if (miColor === 'W') calcularNuevoElo(colorQueAbandona === 'W' ? 'B' : 'W', ganadorText);
    drawBoard(); 
}

async function recibirOfertaTablas(quienOfrece) {
    const textoOponente = quienOfrece === 'W' ? 'las Blancas' : 'las Negras';
    
    if (await showNotification({ title: 'Oferta de tablas', message: `El oponente de ${textoOponente} propone terminar la partida en empate.`, acceptText: 'Aceptar tablas', rejectText: 'Rechazar', tone: 'decision' })) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "accept_draw" })); 
        }
        await showNotification({ title: 'Tablas aceptadas', message: 'La partida terminó en empate.' });
        finalizarPorTablas(); 
    } else {
        showNotification({ title: 'Oferta rechazada', message: 'La partida continúa.' });
    }
}

function finalizarPorTablas() {
    isGameOver = true;          
    partidaIniciada = false; 
    resignBtn.disabled = true; 
    drawBtn.disabled = true; 
    
    turnIndicator.innerHTML = `🤝 Tablas - Empate Acordado`; 
    turnIndicator.style.backgroundColor = '#4b5563'; 
    
    const gameRecord = { 
        winner: "Tablas (Empate)", 
        date: new Date().toLocaleString(), 
        oldW: eloBlancas, newW: eloBlancas, 
        oldB: eloNegras, newB: eloNegras 
    };
    matchHistory.push(gameRecord); 
    localStorage.setItem('chess_match_history', JSON.stringify(matchHistory)); 
    renderHistoryLog();
    drawBoard(); 
}

function resetTableroLocal() {
    isGameOver = false;
    currentTurn = 'W';
    selectedSquare = null;
    validMoves = [];
    currentGameMoves = [];
    
    if(resignBtn) resignBtn.disabled = false;
    if(drawBtn) drawBtn.disabled = false;
    
    boardState = [
        ['t', 'c', 'a', 'q', 'k', 'a', 'c', 't'], 
        ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'], 
        ['',  '',  '',  '',  '',  '',  '',  ''],  
        ['',  '',  '',  '',  '',  '',  '',  ''],  
        ['',  '',  '',  '',  '',  '',  '',  ''],  
        ['',  '',  '',  '',  '',  '',  '',  ''],  
        ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
        ['T', 'C', 'A', 'Q', 'K', 'A', 'C', 'T']  
    ];

    movedPieces = {
        'W_king': false, 'W_rook_a': false, 'W_rook_h': false, 
        'B_king': false, 'B_rook_a': false, 'B_rook_h': false  
    };
    clearPlayerResults();
    if (colorSelector) colorSelector.hidden = true;
    document.querySelectorAll('.color-choice').forEach(choice => choice.disabled = false);
    renderMovesLog();
}

// ====== ADAPTACIÓN VISUAL Y TRADUCCIONES COORDENADAS ======
function actualizarBannerTurno() {
    if (isGameOver) return; 
    if (currentTurn === miColor) { 
        turnIndicator.innerText = "¡Tu turno!"; 
        turnIndicator.style.backgroundColor = '#47a047'; 
    } else {
        turnIndicator.innerText = "Turno del oponente..."; 
        turnIndicator.style.backgroundColor = '#383633'; 
    }
}

function getAlgebraicCoords(row, col) {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']; 
    const numbers = ['8', '7', '6', '5', '4', '3', '2', '1']; 
    return letters[col] + numbers[row]; 
}

function updateEloDisplay() {
    if(eloWhite) eloWhite.innerText = eloBlancas;
    if(eloBlack) eloBlack.innerText = eloNegras;
}

function switchTab(tabName) {
    document.getElementById('tab-moves-btn').classList.remove('active');
    document.getElementById('tab-history-btn').classList.remove('active');
    document.getElementById('tab-moves').classList.remove('active');
    document.getElementById('tab-history').classList.remove('active');
    
    if (tabName === 'moves') { 
        document.getElementById('tab-moves-btn').classList.add('active'); 
        document.getElementById('tab-moves').classList.add('active'); 
    } else if (tabName === 'history') { 
        document.getElementById('tab-history-btn').classList.add('active'); 
        document.getElementById('tab-history').classList.add('active'); 
    }
}

function renderMovesLog() {
    if(!movesLog) return;
    movesLog.innerHTML = ''; 
    if (currentGameMoves.length === 0) { 
        movesLog.innerHTML = '<div style="color:#bababa; padding:12px; font-size:13px;">No hay movimientos.</div>'; 
        return; 
    }
    currentGameMoves.forEach((move, idx) => {
        const row = document.createElement('div'); 
        row.classList.add('move-row'); 
        row.innerHTML = `<span class="move-index">${idx + 1}.</span><span>${move.w}</span><span>${move.b || '...'}</span>`;
        movesLog.appendChild(row); 
    });
    movesLog.scrollTop = movesLog.scrollHeight; 
}

function renderHistoryLog() {
    if(!gamesHistoryLog) return;
    gamesHistoryLog.innerHTML = ''; 
    if (matchHistory.length === 0) { 
        gamesHistoryLog.innerHTML = '<div style="color:#bababa; padding:12px; font-size:13px;">Historial vacío.</div>'; 
        return; 
    }
    matchHistory.slice().reverse().forEach(game => {
        const item = document.createElement('div'); 
        item.classList.add('history-item'); 
        item.innerHTML = `<strong>🏆 ${game.winner}</strong><br><span style="color:#bababa; font-size:11px;">${game.date}</span><br>Elo: B(${game.oldW}➔${game.newW}) | N(${game.oldB}➔${game.newB})`;
        gamesHistoryLog.appendChild(item); 
    });
}

function createCoordinates() {
    if (document.querySelector('.board-wrapper-numbers-left')) return; 

    const leftNumbers = document.createElement('div'); 
    const rightNumbers = document.createElement('div'); 
    leftNumbers.classList.add('board-wrapper-numbers-left'); 
    rightNumbers.classList.add('board-wrapper-numbers-right'); 

    const bottomLetters = document.createElement('div'); 
    const topLetters = document.createElement('div'); 
    bottomLetters.classList.add('board-wrapper-letters-bottom'); 
    topLetters.classList.add('board-wrapper-letters-top'); 

    for (let i = 8; i >= 1; i--) {
        const n1 = document.createElement('div'); n1.innerText = i; 
        const n2 = document.createElement('div'); n2.innerText = i; 
        leftNumbers.appendChild(n1); rightNumbers.appendChild(n2); 
    }

    const lettersArr = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    lettersArr.forEach(l => {
        const l1 = document.createElement('div'); l1.innerText = l; 
        const l2 = document.createElement('div'); l2.innerText = l; 
        bottomLetters.appendChild(l1); topLetters.appendChild(l2); 
    });

    if(wrapper) {
        wrapper.appendChild(leftNumbers);
        wrapper.appendChild(rightNumbers);
        wrapper.appendChild(bottomLetters);
        wrapper.appendChild(topLetters);
    }
}

function getPieceColor(piece) {
    if (!piece) return null; 
    return piece === piece.toUpperCase() ? 'W' : 'B'; 
}

function drawBoard() {
    if(!boardElement) return;
    boardElement.innerHTML = ''; 

    const blackOrientation = miColor === 'B';
    const clockPanel = document.querySelector('.board-clock-panel');
    if (clockPanel) clockPanel.dataset.orientation = blackOrientation ? 'black' : 'white';
    if (blackOrientation) {
        boardElement.style.transform = 'rotate(180deg)'; 
    } else {
        boardElement.style.transform = 'rotate(0deg)'; 
    }
    const fileLabels = blackOrientation ? ['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const rankLabels = blackOrientation ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
    document.querySelectorAll('.board-wrapper-letters-top, .board-wrapper-letters-bottom').forEach(labelRow => {
        labelRow.querySelectorAll('div').forEach((label, index) => label.textContent = fileLabels[index]);
    });
    document.querySelectorAll('.board-wrapper-numbers-left, .board-wrapper-numbers-right').forEach(labelColumn => {
        labelColumn.querySelectorAll('div').forEach((label, index) => label.textContent = rankLabels[index]);
    });

    const whiteKingChecked = isKingInCheck('W'); 
    const blackKingChecked = isKingInCheck('B'); 
    const whiteKingPos = findKing('W'); 
    const blackKingPos = findKing('B'); 

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div'); 
            const isLight = (row + col) % 2 === 0; 
            square.classList.add('square', isLight ? 'light' : 'dark'); 
            square.dataset.row = row; 
            square.dataset.col = col; 
            
            const piece = boardState[row][col]; 
            if (piece) { 
                const pieceElement = document.createElement('span'); 
                pieceElement.innerText = unicodePieces[piece]; 
                pieceElement.classList.add(getPieceColor(piece) === 'W' ? 'piece-white' : 'piece-black');
                if (miColor === 'B') pieceElement.style.transform = 'rotate(180deg)';
                square.appendChild(pieceElement); 
            }
            
            if (whiteKingChecked && whiteKingPos && whiteKingPos.row === row && whiteKingPos.col === col) {
                square.style.backgroundColor = '#b91c1c'; 
            }
            if (blackKingChecked && blackKingPos && blackKingPos.row === row && blackKingPos.col === col) {
                square.style.backgroundColor = '#b91c1c'; 
            }

            if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) square.classList.add('selected');
            
            if (validMoves.some(m => m.row === row && m.col === col)) {
                if (piece && getPieceColor(piece) !== currentTurn) {
                    square.style.filter = 'brightness(0.55)'; 
                } else {
                    square.classList.add('suggested'); 
                }
            }
            
            square.addEventListener('click', handleSquareClick); 
            boardElement.appendChild(square); 
        }
    }
}

function handleSquareClick(event) {
    if (isSpectator || isGameOver || !partidaIniciada) return;
    if (currentTurn !== miColor) return; 

    const square = event.currentTarget; 
    const row = parseInt(square.dataset.row); 
    const col = parseInt(square.dataset.col); 
    const clickedPiece = boardState[row][col]; 
    const clickedColor = getPieceColor(clickedPiece); 

    if (validMoves.some(m => m.row === row && m.col === col)) {
        executeMove(selectedSquare.row, selectedSquare.col, row, col, true); 
        return; 
    }

    if (clickedColor === currentTurn) {
        selectedSquare = { row, col, piece: clickedPiece }; 
        validMoves = calculateValidMoves(row, col, clickedPiece); 
        drawBoard(); 
    } else { 
        selectedSquare = null; 
        validMoves = []; 
        drawBoard(); 
    }
}

function executeMove(fromRow, fromCol, toRow, toCol, enviarServidor = true, piezaPromocionadaRemota = null) {
    let piece = boardState[fromRow][fromCol]; 
    if (!piece) return; 

    const type = piece.toLowerCase(); 
    const color = getPieceColor(piece); 
    let finalPiece = piece; 

    if (type === 'p' && (toRow === 0 || toRow === 7)) {
        if (enviarServidor) { 
            let seleccion = prompt("¡Peón coronado! Elige tu pieza de reclamo:\n Q = Reina, R = Torre, B = Alfil, N = Caballo", "Q");
            if (!seleccion || !['Q','R','B','N','q','r','b','n'].includes(seleccion)) {
                seleccion = 'Q'; 
            }
            finalPiece = color === 'W' ? seleccion.toUpperCase() : seleccion.toLowerCase();
        } else if (piezaPromocionadaRemota) {
            finalPiece = piezaPromocionadaRemota;
        }
    }
    
    boardState[toRow][toCol] = finalPiece;
    boardState[fromRow][fromCol] = '';

    if (enviarServidor && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
            type: "move", 
            fromRow, 
            fromCol, 
            toRow, 
            toCol,
            promotedPiece: finalPiece !== piece ? finalPiece : null 
        }));
    }

    let moveString = `${piece.toUpperCase()}${getAlgebraicCoords(toRow, toCol)}`;
    if (finalPiece !== piece) moveString += `=${finalPiece.toUpperCase()}`; 

    if (color === 'W') { 
        currentGameMoves.push({ w: moveString, b: '' });
    } else { 
        if (currentGameMoves.length > 0) currentGameMoves[currentGameMoves.length - 1].b = moveString;
    }
    renderMovesLog(); 

    if (type === 'k' && Math.abs(toCol - fromCol) === 2) { 
        if (toCol === 6) { 
            boardState[toRow][5] = boardState[toRow][7]; boardState[toRow][7] = ''; 
        }
        else if (toCol === 2) { 
            boardState[toRow][3] = boardState[toRow][0]; boardState[toRow][0] = ''; 
        }
    }

    if (type === 'k') movedPieces[`${color}_king`] = true; 
    if (type === 't' && fromRow === 7 && fromCol === 0) movedPieces['W_rook_a'] = true; 
    if (type === 't' && fromRow === 7 && fromCol === 7) movedPieces['W_rook_h'] = true; 
    if (type === 't' && fromRow === 0 && fromCol === 0) movedPieces['B_rook_a'] = true; 
    if (type === 't' && fromRow === 0 && fromCol === 7) movedPieces['B_rook_h'] = true; 

    selectedSquare = null; 
    validMoves = []; 
    
    currentTurn = currentTurn === 'W' ? 'B' : 'W'; 
    actualizarBannerTurno(); 
    drawBoard(); 

    const activeKingInCheck = isKingInCheck(currentTurn); 
    const hasLegalMovesLeft = playerHasLegalMoves(currentTurn); 

    if (activeKingInCheck && !hasLegalMovesLeft && !isSpectator) {
        isGameOver = true; 
        partidaIniciada = false; 
        if(resignBtn) resignBtn.disabled = true; 
        if(drawBtn) drawBtn.disabled = true; 
        const ganadorText = currentTurn === 'W' ? 'Negras' : 'Blancas'; 
        turnIndicator.innerHTML = `🏆 ¡Jaque Mate! Ganan las ${ganadorText}`; 
        turnIndicator.style.backgroundColor = '#47a047'; 
        if (miColor === 'W') calcularNuevoElo(currentTurn === 'W' ? 'B' : 'W', ganadorText);
        showGameResultNotification(currentTurn === 'W' ? 'B' : 'W', 'checkmate');
        sendRoomGameOver(currentTurn === 'W' ? 'B' : 'W', 'checkmate');
        drawBoard();
    }
}

function calcularNuevoElo(ganadorKey, ganadorTexto) {
    const expectativaW = 1 / (1 + Math.pow(10, (eloNegras - eloBlancas) / 400));
    const expectativaB = 1 / (1 + Math.pow(10, (eloBlancas - eloNegras) / 400));
    const oldW = eloBlancas; const oldB = eloNegras; 

    if (ganadorKey === 'D') { 
        eloBlancas = Math.round(eloBlancas + FACTOR_K * (0.5 - expectativaW)); 
        eloNegras = Math.round(eloNegras + FACTOR_K * (0.5 - expectativaB)); 
    } else { 
        eloBlancas = Math.round(eloBlancas + FACTOR_K * ((ganadorKey === 'W' ? 1 : 0) - expectativaW));
        eloNegras = Math.round(eloNegras + FACTOR_K * ((ganadorKey === 'B' ? 1 : 0) - expectativaB));
    }

    localStorage.setItem('elo_blancas', eloBlancas);
    localStorage.setItem('elo_negras', eloNegras);
    updateEloDisplay(); 

    const gameRecord = { winner: ganadorTexto, date: new Date().toLocaleString(), oldW, newW: eloBlancas, oldB, newB: eloNegras };
    matchHistory.push(gameRecord); 
    localStorage.setItem('chess_match_history', JSON.stringify(matchHistory)); 
    renderHistoryLog(); 
}

function findKing(color) {
    const targetKing = color === 'W' ? 'K' : 'k'; 
    for (let r = 0; r < 8; r++) { 
        for (let c = 0; c < 8; c++) { if (boardState[r][c] === targetKing) return { row: r, col: c }; } 
    }
    return null; 
}

function getRawMoves(row, col, piece) {
    let moves = []; const type = piece.toLowerCase(); const color = getPieceColor(piece); 
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]]; 

    switch (type) {
        case 'p': 
            const dir = color === 'W' ? -1 : 1; 
            [-1, 1].forEach(c => { if (col + c >= 0 && col + c < 8 && row + dir >= 0 && row + dir < 8) moves.push({ row: row + dir, col: col + c }); });
            break;
        case 't': straightDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break; 
        case 'a': diagDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break; 
        case 'q': straightDirs.concat(diagDirs).forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break; 
        case 'k': 
            straightDirs.concat(diagDirs).forEach(d => {
                const nR = row + d[0], nC = col + d[1]; 
                if (nR >= 0 && nR < 8 && nC >= 0 && nC < 8) moves.push({ row: nR, col: nC }); 
            });
            break;
        case 'c': 
            [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(m => {
                const nR = row + m[0], nC = col + m[1]; 
                if (nR >= 0 && nR < 8 && nC >= 0 && nC < 8) moves.push({ row: nR, col: nC }); 
            });
            break;
    }
    return moves; 
}

// ====== LOGICA DE RECONOCIMIENTO DE JAQUES ======
function isKingInCheck(color) {
    const kingPos = findKing(color); if (!kingPos) return false; 
    const oppColor = color === 'W' ? 'B' : 'W'; 
    for (let r = 0; r < 8; r++) { 
        for (let c = 0; c < 8; c++) {
            const p = boardState[r][c]; 
            if (p && getPieceColor(p) === oppColor && getRawMoves(r, c, p).some(m => m.row === kingPos.row && m.col === kingPos.col)) return true; 
        }
    }
    return false; 
}

function playerHasLegalMoves(color) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = boardState[r][c];
            if (p && getPieceColor(p) === color && calculateValidMoves(r, c, p).length > 0) return true;
        }
    }
    return false; 
}

function calculateValidMoves(row, col, piece) {
    let moves = []; const type = piece.toLowerCase(); const color = getPieceColor(piece);
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    switch (type) {
        case 'p': 
            const d = color === 'W' ? -1 : 1; 
            if (row + d >= 0 && row + d < 8 && boardState[row + d][col] === '') { 
                moves.push({ row: row + d, col }); 
                if (row === (color === 'W' ? 6 : 1) && boardState[row + d * 2][col] === '') {
                    moves.push({ row: row + d * 2, col });
                }
            }
            [col - 1, col + 1].forEach(c => {
                if (c >= 0 && c < 8 && row + d >= 0 && row + d < 8 && boardState[row + d][c] && getPieceColor(boardState[row + d][c]) !== color) {
                    moves.push({ row: row + d, col: c });
                }
            });
            break;
        case 't': straightDirs.forEach(dir => moves = moves.concat(getLineMoves(row, col, dir[0], dir[1], color))); break;
        case 'a': diagDirs.forEach(dir => moves = moves.concat(getLineMoves(row, col, dir[0], dir[1], color))); break;
        case 'q': straightDirs.concat(diagDirs).forEach(dir => moves = moves.concat(getLineMoves(row, col, dir[0], dir[1], color))); break;
        case 'k': 
            straightDirs.concat(diagDirs).forEach(dir => {
                const nR = row + dir[0], nC = col + dir[1];
                if (nR >= 0 && nR < 8 && nC >= 0 && nC < 8 && (boardState[nR][nC] === '' || getPieceColor(boardState[nR][nC]) !== color)) moves.push({ row: nR, col: nC });
            });
            if (!movedPieces[`${color}_king`]) { 
                const r = color === 'W' ? 7 : 0; 
                if (!movedPieces[`${color}_rook_h`] && boardState[r][5] === '' && boardState[r][6] === '') moves.push({ row: r, col: 6 });
                if (!movedPieces[`${color}_rook_a`] && boardState[r][1] === '' && boardState[r][2] === '' && boardState[r][3] === '') moves.push({ row: r, col: 2 });
            }
            break;
        case 'c': 
            [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(m => {
                const nR = row + m[0], nC = col + m[1];
                if (nR >= 0 && nR < 8 && nC >= 0 && nC < 8 && (boardState[nR][nC] === '' || getPieceColor(boardState[nR][nC]) !== color)) moves.push({ row: nR, col: nC });
            });
            break;
    }

    return moves.filter(m => {
        const dest = boardState[m.row][m.col]; 
        boardState[m.row][m.col] = piece; boardState[row][col] = ''; 
        const check = isKingInCheck(color); 
        boardState[row][col] = piece; boardState[m.row][m.col] = dest; 
        return !check; 
    });
}

function getLineMoves(row, col, rowDir, colDir, color) {
    const lm = []; let r = row + rowDir; let c = col + colDir; 
    while (r >= 0 && r < 8 && c >= 0 && c < 8) { 
        if (boardState[r][c] === '') { 
            lm.push({ row: r, col: c }); 
        } else { 
            if (getPieceColor(boardState[r][c]) !== color) { 
                lm.push({ row: r, col: c }); 
            }
            break; 
        }
        r += rowDir; c += colDir; 
    }
    return lm; 
}

// ====== INICIALIZACIÓN ======
createCoordinates(); 
updateEloDisplay(); 
renderMovesLog(); 
renderHistoryLog(); 
drawBoard();