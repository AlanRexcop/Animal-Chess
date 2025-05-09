// aiWorker.js
import {
    PIECES, 
} from './constants.js'; 

import AiModuleFactory from './ai_engine.js';

let AiModule = null; 
let pieceTypeIndexToName = []; 

async function initializeWorker() {
    if (AiModule) return; 

    const pieceOrderForMapping = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'];
    pieceTypeIndexToName = pieceOrderForMapping;

    try {
        AiModule = await AiModuleFactory(); // AiModule should now be the Emscripten Module object
        if (!AiModule || typeof AiModule._initializeAiEngine !== 'function') {
            throw new Error("Wasm module loaded but _initializeAiEngine is not available.");
        }
        if (typeof AiModule._malloc !== 'function' || typeof AiModule.HEAP32 !== 'object') {
             throw new Error("Wasm module loaded but _malloc or HEAP32 is not available. Check EXPORTED_RUNTIME_METHODS.");
        }
        AiModule._initializeAiEngine();
        console.log("[Worker] Wasm AI Engine Initialized.");
    } catch (e) {
        console.error("[Worker] Error initializing Wasm AI Engine:", e);
        self.postMessage({
            move: null, depthAchieved: 0, nodes: 0, eval: null,
            error: "Wasm Init Failed: " + (e.message || e)
        });
        throw e; 
    }
}

function serializeBoardForWasm(boardState) {
    const rows = boardState.length;
    const cols = boardState[0].length;
    const flatData = new Int32Array(2 + rows * cols * 3);
    flatData[0] = rows;
    flatData[1] = cols;
    let k = 2;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = boardState[r][c];
            flatData[k++] = cell.terrain;
            if (cell.piece) {
                const pieceTypeIdx = pieceTypeIndexToName.indexOf(cell.piece.type.toLowerCase());
                if (pieceTypeIdx === -1) {
                    console.error(`[Worker] Unknown piece type for Wasm: ${cell.piece.type}`);
                    flatData[k++] = -1; 
                } else {
                    flatData[k++] = pieceTypeIdx;
                }
                flatData[k++] = cell.piece.player;
            } else {
                flatData[k++] = -1; 
                flatData[k++] = -1; 
            }
        }
    }
    return flatData;
}


self.onmessage = async function(e) {
    const { boardState, targetDepth, timeLimit } = e.data;

    if (!AiModule) {
        try {
            await initializeWorker();
        } catch (initError) {
            return;
        }
    }
    
    // Defensive check after initialization
    if (!AiModule || typeof AiModule._malloc !== 'function' || typeof AiModule.HEAP32 === 'undefined') {
        const errorMsg = "[Worker] AiModule or its properties (_malloc, HEAP32) are not available after init.";
        console.error(errorMsg, AiModule);
        self.postMessage({
            move: null, depthAchieved: 0, nodes: 0, eval: null,
            error: errorMsg
        });
        return;
    }


    if (!boardState || typeof targetDepth !== 'number' || typeof timeLimit !== 'number') {
        console.error("[Worker] Invalid message data received:", e.data);
        self.postMessage({
            move: null, depthAchieved: 0, nodes: 0, eval: null,
            error: "Invalid data received by worker"
        });
        return;
    }
    
    let result = {
        move: null, depthAchieved: 0, nodes: 0, eval: null, error: null
    };
    let boardDataPtr = 0; // Initialize to 0 or null
    let resultBufferPtr = 0; // Initialize to 0 or null

    try {
        const flatBoardData = serializeBoardForWasm(boardState);

        boardDataPtr = AiModule._malloc(flatBoardData.byteLength);
        if (!boardDataPtr) throw new Error("AiModule._malloc failed for boardDataPtr");
        AiModule.HEAP32.set(flatBoardData, boardDataPtr / 4); // HEAP32 is an Int32Array view

        resultBufferPtr = AiModule._malloc(10 * 4); 
        if (!resultBufferPtr) throw new Error("AiModule._malloc failed for resultBufferPtr");
        
        AiModule._findBestMoveWasm(boardDataPtr, targetDepth, timeLimit, resultBufferPtr);

        // Create a new Int32Array view for the result buffer for safe slicing
        const wasmResultArray = new Int32Array(AiModule.HEAP32.buffer, resultBufferPtr, 10);
        // const wasmResult = Array.from(wasmResultArray); // Convert to plain array if slice not working as expected or for easier debugging. Or just use wasmResultArray[index]
        const wasmResult = wasmResultArray.slice(); // Get a copy

        const moveFound = wasmResult[0];
        if (moveFound === 1) {
            const pieceTypeMovedIdx = wasmResult[5];
            if (pieceTypeMovedIdx >= 0 && pieceTypeMovedIdx < pieceTypeIndexToName.length) {
                result.move = {
                    fromRow: wasmResult[1],
                    fromCol: wasmResult[2],
                    toRow: wasmResult[3],
                    toCol: wasmResult[4],
                    pieceName: PIECES[pieceTypeIndexToName[pieceTypeMovedIdx]]?.name || "Unknown" 
                };
            } else {
                console.error("[Worker] Invalid pieceTypeMovedIdx from Wasm:", pieceTypeMovedIdx);
                result.error = "Invalid piece type index from Wasm."
            }
        }
        result.depthAchieved = wasmResult[6];
        result.nodes = wasmResult[7];
        result.eval = wasmResult[8] === 888888 ? null : wasmResult[8]; 
        
        const errorCode = wasmResult[9];
        // Only set error if it's not already set by invalid pieceTypeMovedIdx
        if (!result.error) {
            if(wasmResult[8] === 888888 && errorCode === 0) { 
                result.error = "Timeout"; 
            } else if (errorCode === 1) {
                result.error = "No moves available";
            } else if (errorCode === 2) {
                result.error = "Wasm general error";
            }
        }

    } catch (err) {
        console.error("[Worker] Error during Wasm execution:", err);
        result.error = "Wasm Execution Failed: " + (err.message || err);
    } finally {
        // Free allocated Wasm memory if pointers are valid
        if (AiModule && typeof AiModule._free === 'function') {
            if (boardDataPtr) AiModule._free(boardDataPtr);
            if (resultBufferPtr) AiModule._free(resultBufferPtr);
        }
        self.postMessage(result);
    }
};