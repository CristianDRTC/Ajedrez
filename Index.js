const boardElement = document.getElementById('chessboard');
const wrapper = document.querySelector('.board-wrapper');
const turnIndicator = document.getElementById('turn-indicator');
const eloPanel = document.getElementById('elo-panel');
const restartBtn = document.getElementById('restart-btn');
const movesLog = document.getElementById('moves-log');
const gamesHistoryLog = document.getElementById('games-history-log');

let currentTurn = 'W'; 
let selectedSquare = null;
let validMoves = [];
let isGameOver = false;

// --- LISTAS DE HISTORIALES ---
let currentGameMoves = []; 
let matchHistory = JSON.parse(localStorage.getItem('chess_match_history')) || [];

// --- VARIABLES ELO PERSISTENTES ---
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
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    if (tabName === 'moves') {
        document.getElementById('tab-moves-btn').classList.add('active');
        document.getElementById('tab-moves').classList.add('active');
    } else {
        document.getElementById('tab-history-btn').classList.add('active');
        document.getElementById('tab-history').classList.add('active');
    }
}

function renderMovesLog() {
    movesLog.innerHTML = '';
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
        gamesHistoryLog.innerHTML = '<div style="color:#64748b; padding:10px;">No hay partidas registradas.</div>';
        return;
    }
    matchHistory.slice().reverse().forEach(game => {
        const item = document.createElement('div');
        item.classList.add('history-item');
        item.innerHTML = `
            <strong>🏆 Ganador: ${game.winner}</strong><br>
            <span style="color:#64748b; font-size:11px;">${game.date}</span><br>
            Var. Elo: Blancas (${game.oldW} ➜ ${game.newW}) | Negras (${game.oldB} ➜ ${game.newB})
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
        const num1 = document.createElement('div');
        const num2 = document.createElement('div');
        num1.innerText = i; num2.innerText = i;
        leftNumbers.appendChild(num1);
        rightNumbers.appendChild(num2);
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
    
    // --- EFECTO DE ROTACIÓN SEGÚN EL TURNO ---
    // Si juegan negras ('B'), rotamos el tablero 180 grados. De lo contrario, vuelve a 0.
    if (currentTurn === 'B' && !isGameOver) {
        boardElement.style.transform = 'rotate(180deg)';
        document.querySelectorAll('.board-wrapper-numbers-left, .board-wrapper-numbers-right').forEach(el => {
            el.style.transform = 'rotate(180deg)';
        });
    } else {
        boardElement.style.transform = 'rotate(0deg)';
        document.querySelectorAll('.board-wrapper-numbers-left, .board-wrapper-numbers-right').forEach(el => {
            el.style.transform = 'rotate(0deg)';
        });
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
            
            // Suavizar las transiciones visuales de rotación
            square.style.transition = 'transform 0.5s ease, background-color 0.15s ease';
            
            const piece = boardState[row][col];
            if (piece) {
                const pieceElement = document.createElement('span');
                pieceElement.innerText = unicodePieces[piece];
                pieceElement.classList.add(getPieceColor(piece) === 'W' ? 'piece-white' : 'piece-black');
                
                // Rotar las piezas inversamente para que no queden al revés al girar el tablero
                if (currentTurn === 'B' && !isGameOver) {
                    pieceElement.style.transform = 'rotate(180deg)';
                } else {
                    pieceElement.style.transform = 'rotate(0deg)';
                }
                pieceElement.style.transition = 'transform 0.5s ease';
                
                square.appendChild(pieceElement);
            }
            
            // Jaques visuales
            if (whiteKingChecked && whiteKingPos && whiteKingPos.row === row && whiteKingPos.col === col) {
                square.style.backgroundColor = '#fca5a5'; 
            } else if (blackKingChecked && blackKingPos && blackKingPos.row === row && blackKingPos.col === col) {
                square.style.backgroundColor = '#fca5a5'; 
            }

            if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
                square.classList.add('selected');
            }

            // --- LÓGICA DE SUGERENCIAS Y CASILLAS DE CAPTURA GRIS ---
            if (validMoves.some(m => m.row === row && m.col === col)) {
                if (piece && getPieceColor(piece) !== currentTurn) {
                    // Si hay una ficha enemiga en la casilla sugerida, se colorea de gris oscuro/suave
                    square.style.backgroundColor = '#a1a1aa'; 
                } else {
                    // Si está vacía, se usa el indicador de punto estándar del CSS
                    square.classList.add('suggested');
                }
            }
            
            square.addEventListener('click', handleSquareClick);
            boardElement.appendChild(square);
        }
    }
}

function handleSquareClick(event) {
    if (isGameOver) return;
    const square = event.currentTarget;
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPiece = boardState[row][col];
    const clickedColor = getPieceColor(clickedPiece);

    if (validMoves.some(m => m.row === row && m.col === col)) {
        executeMove(selectedSquare.row, selectedSquare.col, row, col);
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

function executeMove(fromRow, fromCol, toRow, toCol) {
    const piece = boardState[fromRow][fromCol];
    const type = piece.toLowerCase();
    const color = getPieceColor(piece);
    
    const moveString = `${piece.toUpperCase()}${getAlgebraicCoords(toRow, toCol)}`;
    if (color === 'W') {
        currentGameMoves.push({ w: moveString, b: '' });
    } else {
        if (currentGameMoves.length > 0) {
            currentGameMoves[currentGameMoves.length - 1].b = moveString;
        }
    }
    renderMovesLog();

    if (type === 'k' && Math.abs(toCol - fromCol) === 2) {
        if (toCol === 6) {
            boardState[toRow][5] = boardState[toRow][7]; boardState[toRow][7] = '';
        } else if (toCol === 2) {
            boardState[toRow][3] = boardState[toRow][0]; boardState[toRow][0] = '';
        }
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
    turnIndicator.innerText = currentTurn === 'W' ? 'Turno: Blancas' : 'Turno: Negras';
    
    drawBoard();

    const activeKingInCheck = isKingInCheck(currentTurn);
    const hasLegalMovesLeft = playerHasLegalMoves(currentTurn);

    if (activeKingInCheck && !hasLegalMovesLeft) {
        isGameOver = true;
        const ganador = currentTurn === 'W' ? 'Negras' : 'Blancas';
        turnIndicator.innerHTML = `🏆 ¡Jaque Mate! Ganan las ${ganador}`;
        turnIndicator.style.backgroundColor = '#15803d';
        calcularNuevoElo(currentTurn === 'W' ? 'B' : 'W', ganador);
        drawBoard(); // Redibujar una última vez para asegurar orientación final estable
    }
}

function calcularNuevoElo(ganadorKey, ganadorTexto) {
    const expectativaW = 1 / (1 + Math.pow(10, (eloNegras - eloBlancas) / 400));
    const expectativaB = 1 / (1 + Math.pow(10, (eloBlancas - eloNegras) / 400));

    const resultadoW = ganadorKey === 'W' ? 1 : 0;
    const resultadoB = ganadorKey === 'B' ? 1 : 0;

    const oldW = eloBlancas;
    const oldB = eloNegras;

    eloBlancas = Math.round(eloBlancas + FACTOR_K * (resultadoW - expectativaW));
    eloNegras = Math.round(eloNegras + FACTOR_K * (resultadoB - expectativaB));

    localStorage.setItem('elo_blancas', eloBlancas);
    localStorage.setItem('elo_negras', eloNegras);
    updateEloDisplay();

    const gameRecord = {
        winner: ganadorTexto,
        date: new Date().toLocaleString(),
        oldW, newW: eloBlancas,
        oldB, newB: eloNegras
    };
    matchHistory.push(gameRecord);
    localStorage.setItem('chess_match_history', JSON.stringify(matchHistory));
    renderHistoryLog();
}

function resetGame() {
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
    currentTurn = 'W';
    selectedSquare = null;
    validMoves = [];
    isGameOver = false;
    currentGameMoves = [];
    
    movedPieces = {
        'W_king': false, 'W_rook_a': false, 'W_rook_h': false,
        'B_king': false, 'B_rook_a': false, 'B_rook_h': false
    };

    turnIndicator.innerText = 'Turno: Blancas';
    turnIndicator.style.backgroundColor = '#475569';
    
    renderMovesLog();
    drawBoard();
}

function findKing(color) {
    const targetKing = color === 'W' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (boardState[r][c] === targetKing) return { row: r, col: c };
        }
    }
    return null;
}

function getRawMoves(row, col, piece) {
    let moves = [];
    const type = piece.toLowerCase();
    const color = getPieceColor(piece);
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    switch (type) {
        case 'p':
            const dir = color === 'W' ? -1 : 1;
            const captureCols = [col - 1, col + 1];
            captureCols.forEach(c => {
                if (c >= 0 && c < 8 && row + dir >= 0 && row + dir < 8) moves.push({ row: row + dir, col: c });
            });
            break;
        case 't': straightDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'a': diagDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'q': straightDirs.concat(diagDirs).forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'k':
            straightDirs.concat(diagDirs).forEach(d => {
                const nRow = row + d[0], nCol = col + d[1];
                if (nRow >= 0 && nRow < 8 && nCol >= 0 && nCol < 8) moves.push({ row: nRow, col: nCol });
            });
            break;
        case 'c':
            const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
            knightMoves.forEach(m => {
                const nRow = row + m[0], nCol = col + m[1];
                if (nRow >= 0 && nRow < 8 && nCol >= 0 && nCol < 8) moves.push({ row: nRow, col: nCol });
            });
            break;
    }
    return moves;
}

function isKingInCheck(color) {
    const kingPos = findKing(color);
    if (!kingPos) return false;
    const opponentColor = color === 'W' ? 'B' : 'W';

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r][c];
            if (piece && getPieceColor(piece) === opponentColor) {
                const moves = getRawMoves(r, c, piece);
                if (moves.some(m => m.row === kingPos.row && m.col === kingPos.col)) return true;
            }
        }
    }
    return false;
}

function playerHasLegalMoves(color) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r][c];
            if (piece && getPieceColor(piece) === color) {
                const moves = calculateValidMoves(r, c, piece);
                if (moves.length > 0) return true; 
            }
        }
    }
    return false;
}

function calculateValidMoves(row, col, piece) {
    let moves = [];
    const type = piece.toLowerCase();
    const color = getPieceColor(piece);
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    switch (type) {
        case 'p':
            const dir = color === 'W' ? -1 : 1; 
            const startRow = color === 'W' ? 6 : 1;
            if (row + dir >= 0 && row + dir < 8 && boardState[row + dir][col] === '') {
                moves.push({ row: row + dir, col });
                if (row === startRow && boardState[row + dir * 2][col] === '') moves.push({ row: row + dir * 2, col });
            }
            [col - 1, col + 1].forEach(c => {
                if (c >= 0 && c < 8 && row + dir >= 0 && row + dir < 8) {
                    const targetPiece = boardState[row + dir][c];
                    if (targetPiece && getPieceColor(targetPiece) !== color) moves.push({ row: row + dir, col: c });
                }
            });
            break;
        case 't': straightDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'a': diagDirs.forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'q': straightDirs.concat(diagDirs).forEach(d => moves = moves.concat(getLineMoves(row, col, d[0], d[1], color))); break;
        case 'k':
            straightDirs.concat(diagDirs).forEach(d => {
                const nRow = row + d[0], nCol = col + d[1];
                if (nRow >= 0 && nRow < 8 && nCol >= 0 && nCol < 8) {
                    if (boardState[nRow][nCol] === '' || getPieceColor(boardState[nRow][nCol]) !== color) moves.push({ row: nRow, col: nCol });
                }
            });
            if (!movedPieces[`${color}_king`]) {
                const r = color === 'W' ? 7 : 0;
                if (!movedPieces[`${color}_rook_h`] && boardState[r][5] === '' && boardState[r][6] === '') moves.push({ row: r, col: 6 });
                if (!movedPieces[`${color}_rook_a`] && boardState[r][1] === '' && boardState[r][2] === '' && boardState[r][3] === '') moves.push({ row: r, col: 2 });
            }
            break;
        case 'c':
            const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
            knightMoves.forEach(m => {
                const nRow = row + m[0], nCol = col + m[1];
                if (nRow >= 0 && nRow < 8 && nCol >= 0 && nCol < 8) {
                    if (boardState[nRow][nCol] === '' || getPieceColor(boardState[nRow][nCol]) !== color) moves.push({ row: nRow, col: nCol });
                }
            });
            break;
    }

    return moves.filter(m => {
        const originalDest = boardState[m.row][m.col];
        boardState[m.row][m.col] = piece; boardState[row][col] = '';
        const selfInCheck = isKingInCheck(color);
        boardState[row][col] = piece; boardState[m.row][m.col] = originalDest;
        return !selfInCheck;
    });
}

function getLineMoves(row, col, rowDir, colDir, color) {
    const lineMoves = [];
    let r = row + rowDir; let c = col + colDir;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        if (boardState[r][c] === '') lineMoves.push({ row: r, col: c });
        else {
            if (getPieceColor(boardState[r][c]) !== color) lineMoves.push({ row: r, col: c });
            break; 
        }
        r += rowDir; c += colDir;
    }
    return lineMoves;
}

restartBtn.addEventListener('click', resetGame);
createCoordinates();
updateEloDisplay();
renderHistoryLog();
drawBoard();