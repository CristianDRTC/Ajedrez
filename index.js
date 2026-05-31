const boardElement = document.getElementById('chessboard');
const wrapper = document.querySelector('.board-wrapper');
const turnIndicator = document.getElementById('turn-indicator');
const eloPanel = document.getElementById('elo-panel');
const restartBtn = document.getElementById('restart-btn');
const movesLog = document.getElementById('moves-log');
const gamesHistoryLog = document.getElementById('games-history-log');

const socket = new WebSocket('wss://ajedrez-backend-fyjz.onrender.com');

let miColor = null; 
let partidaIniciada = false;
let currentTurn = 'W'; 
let selectedSquare = null;
let validMoves = [];
let isGameOver = false;

let currentGameMoves = []; 
let matchHistory = JSON.parse(localStorage.getItem('chess_match_history')) || [];
let eloBlancas = parseInt(localStorage.getItem('elo_blancas')) || 1000;
let eloNegras = parseInt(localStorage.getItem('elo_negras')) || 1000;
const FACTOR_K = 20;

let movedPieces = {
    'W_king': false, 'W_rook_a': false, 'W_rook_h': false,
    'B_king': false, 'B_rook_a': false, 'B_rook_h': false
};

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

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
        miColor = data.color;
        turnIndicator.innerText = `Eres las ${miColor === 'W' ? 'Blancas ⬜' : 'Negras ⬛'}. Esperando rival...`;
        turnIndicator.style.backgroundColor = '#1e3a8a';
        drawBoard();
    }
    if (data.type === 'start') {
        partidaIniciada = true;
        restartBtn.disabled = false;
        actualizarBannerTurno();
        drawBoard();
    }
    if (data.type === 'move') {
        executeMove(data.fromRow, data.fromCol, data.toRow, data.toCol, false);
    }
    if (data.type === 'restart') {
        resetGameLocal();
    }
    if (data.type === 'opponent_left') {
        partidaIniciada = false;
        restartBtn.disabled = true;
        turnIndicator.innerText = "El rival abandonó la sala. Esperando oponente...";
        turnIndicator.style.backgroundColor = '#b45309';
    }
    if (data.type === 'error') {
        alert(data.message);
    }
};

socket.onerror = function() {
    turnIndicator.innerText = "Error al conectar con el servidor de internet";
    turnIndicator.style.backgroundColor = '#7f1d1d';
};

function actualizarBannerTurno() {
    if (isGameOver) return;
    if (currentTurn === miColor) {
        turnIndicator.innerText = "¡Tu turno!";
        turnIndicator.style.backgroundColor = '#1e3a8a';
    } else {
        turnIndicator.innerText = "Turno del oponente...";
        turnIndicator.style.backgroundColor = '#475569';
    }
}

function getAlgebraicCoords(row, col) {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const numbers = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return letters[col] + numbers[row];
}

function updateEloDisplay() {
    eloPanel.innerHTML = `
        <span>⬜ Blancas: ${eloBlancas}</span>
        <span>⬛ Negras: ${eloNegras}</span>
    `;
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
    movesLog.innerHTML = ''; 
    if (currentGameMoves.length === 0) {
        movesLog.innerHTML = '<div style="color:#64748b; padding:10px;">No hay movimientos aún.</div>';
        return;
    }
    currentGameMoves.forEach((move, idx) => {
        const row = document.createElement('div');
        row.classList.add('move-row');
        row.innerHTML = `
            <span class="move-index">${idx + 1}.</span>
            <span>${move.w}</span>
            <span>${move.b || '...'}</span>
        `;
        movesLog.appendChild(row);
    });
    movesLog.scrollTop = movesLog.scrollHeight;
}

function renderHistoryLog() {
    gamesHistoryLog.innerHTML = ''; 
    if (matchHistory.length === 0) {
        gamesHistoryLog.innerHTML = '<div style="color:#64748b; padding:10px;">No hay partidas guardadas.</div>';
        return;
    }
    matchHistory.slice().reverse().forEach(game => {
        const item = document.createElement('div');
        item.classList.add('history-item');
        item.innerHTML = `
            <strong>🏆 Ganó: ${game.winner}</strong><br>
            <span style="color:#64748b; font-size:11px;">${game.date}</span><br>
            Elo: B(${game.oldW}➔${game.newW}) | N(${game.oldB}➔${game.newB})
        `;
        gamesHistoryLog.appendChild(item);
    });
}

function createCoordinates() {
    const leftNumbers = document.createElement('div');
    const rightNumbers = document.createElement('div');
    leftNumbers.classList.add('board-wrapper-numbers-left');
    rightNumbers.classList.add('board-wrapper-numbers-right');

    for (let i = 8; i >= 1; i--) {
        const num1 = document.createElement('div'); const num2 = document.createElement('div');
        num1.innerText = i; num2.innerText = i;
        leftNumbers.appendChild(num1); rightNumbers.appendChild(num2);
    }
    wrapper.appendChild(leftNumbers);
    wrapper.appendChild(rightNumbers);
}

function getPieceColor(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'W' : 'B';
}

function drawBoard() {
    boardElement.innerHTML = '';
    
    if (miColor === 'B') {
        boardElement.style.transform = 'rotate(180deg)';
        document.querySelectorAll('.board-wrapper-numbers-left, .board-wrapper-numbers-right').forEach(el => el.style.transform = 'rotate(180deg)');
    } else {
        boardElement.style.transform = 'rotate(0deg)';
        document.querySelectorAll('.board-wrapper-numbers-left, .board-wrapper-numbers-right').forEach(el => el.style.transform = 'rotate(0deg)');
    }

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
            
            if (whiteKingChecked && whiteKingPos && whiteKingPos.row === row && whiteKingPos.col === col) square.style.backgroundColor = '#fca5a5';
            if (blackKingChecked && blackKingPos && blackKingPos.row === row && blackKingPos.col === col) square.style.backgroundColor = '#fca5a5';

            if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) square.classList.add('selected');

            if (validMoves.some(m => m.row === row && m.col === col)) {
                if (piece && getPieceColor(piece) !== currentTurn) {
                    square.style.backgroundColor = '#a1a1aa'; 
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
    if (isGameOver || !partidaIniciada) return;
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

function executeMove(fromRow, fromCol, toRow, toCol, enviarServidor = true) {
    const piece = boardState[fromRow][fromCol];
    const type = piece.toLowerCase();
    const color = getPieceColor(piece);
    
    if (enviarServidor && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "move", fromRow, fromCol, toRow, toCol }));
    }

    const moveString = `${piece.toUpperCase()}${getAlgebraicCoords(toRow, toCol)}`;
    if (color === 'W') {
        currentGameMoves.push({ w: moveString, b: '' });
    } else {
        if (currentGameMoves.length > 0) currentGameMoves[currentGameMoves.length - 1].b = moveString;
    }
    renderMovesLog();

    if (type === 'k' && Math.abs(toCol - fromCol) === 2) {
        if (toCol === 6) { boardState[toRow][5] = boardState[toRow][7]; boardState[toRow][7] = ''; }
        else if (toCol === 2) { boardState[toRow][3] = boardState[toRow][0]; boardState[toRow][0] = ''; }
    }

    if (type === 'k') movedPieces[`${color}_king`] = true;
    if (type === 't' && fromRow === 7 && fromCol === 0) movedPieces['W_rook_a'] = true;
    if (type === 't' && fromRow === 7 && fromCol === 7) movedPieces['W_rook_h'] = true;
    if (type === 't' && fromRow === 0 && fromCol === 0) movedPieces['B_rook_a'] = true;
    if (type === 't' && fromRow === 0 && fromCol === 7) movedPieces['B_rook_h'] = true;

    boardState[toRow][toCol] = piece;
    boardState[fromRow][fromCol] = '';
    selectedSquare = null;
    validMoves = [];
    
    currentTurn = currentTurn === 'W' ? 'B' : 'W';
    actualizarBannerTurno();
    drawBoard();

    const activeKingInCheck = isKingInCheck(currentTurn);
    const hasLegalMovesLeft = playerHasLegalMoves(currentTurn);

    if (activeKingInCheck && !hasLegalMovesLeft) {
        isGameOver = true;
        const ganadorText = currentTurn === 'W' ? 'Negras' : 'Blancas';
        turnIndicator.innerHTML = `🏆 ¡Jaque Mate! Ganan las ${ganadorText}`;
        turnIndicator.style.backgroundColor = '#15803d';
        
        if (miColor === 'W') {
            calcularNuevoElo(currentTurn === 'W' ? 'B' : 'W', ganadorText);
        }
    }
}

function calcularNuevoElo(ganadorKey, ganadorTexto) {
    const expectativaW = 1 / (1 + Math.pow(10, (eloNegras - eloBlancas) / 400));
    const expectativaB = 1 / (1 + Math.pow(10, (eloBlancas - eloNegras) / 400));

    const oldW = eloBlancas; const oldB = eloNegras;

    eloBlancas = Math.round(eloBlancas + FACTOR_K * ((ganadorKey === 'W' ? 1 : 0) - expectativaW));
    eloNegras = Math.round(eloNegras + FACTOR_K * ((ganadorKey === 'B' ? 1 : 0) - expectativaB));

    localStorage.setItem('elo_blancas', eloBlancas);
    localStorage.setItem('elo_negras', eloNegras);
    updateEloDisplay();

    const gameRecord = { winner: ganadorTexto, date: new Date().toLocaleString(), oldW, newW: eloBlancas, oldB, newB: eloNegras };
    matchHistory.push(gameRecord);
    localStorage.setItem('chess_match_history', JSON.stringify(matchHistory));
    renderHistoryLog();
}

restartBtn.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: "restart" }));
});

function resetGameLocal() {
    boardState = [
        ['t', 'c', 'a', 'q', 'k', 'a', 'c', 't'], ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], ['T', 'C', 'A', 'Q', 'K', 'A', 'C', 'T']
    ];
    currentTurn = 'W'; selectedSquare = null; validMoves = []; isGameOver = false; currentGameMoves = [];
    movedPieces = { 'W_king': false, 'W_rook_a': false, 'W_rook_h': false, 'B_king': false, 'B_rook_a': false, 'B_rook_h': false };
    actualizarBannerTurno();
    renderMovesLog(); 
    drawBoard();
}

function findKing(color) {
    const targetKing = color === 'W' ? 'K' : 'k';
    for (let r = 0; r
