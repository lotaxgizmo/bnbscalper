import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the file
const filePath = path.join(process.cwd(), 'pivotBacktester.js');
const content = fs.readFileSync(filePath, 'utf8').split('\n');

// Find and update the high pivot edge display section
let inHighPivotSection = false;
let inLowPivotSection = false;
let highPivotLine = 0;
let lowPivotLine = 0;

for (let i = 0; i < content.length; i++) {
    // Check for high pivot section
    if (content[i].includes('const isHighPivot = detectPivot(candles, i, pivotLookback, \'high\');')) {
        inHighPivotSection = true;
    }
    
    // Check for low pivot section
    if (content[i].includes('const isLowPivot = detectPivot(candles, i, pivotLookback, \'low\');')) {
        inLowPivotSection = true;
        inHighPivotSection = false;
    }
    
    // Look for edge data display in high pivot section
    if (inHighPivotSection && content[i].includes('// Display edge data') && 
        content[i+1] && content[i+1].includes('if (pivotEdgeData)')) {
        highPivotLine = i;
    }
    
    // Look for edge data display in low pivot section
    if (inLowPivotSection && content[i].includes('// Display edge data') && 
        content[i+1] && content[i+1].includes('if (pivotEdgeData)')) {
        lowPivotLine = i;
    }
    
    // Reset section flags
    if (content[i].includes('if (isHighPivot)') || content[i].includes('if (isLowPivot)')) {
        inHighPivotSection = false;
        inLowPivotSection = false;
    }
}

// Update the high pivot edge display section
if (highPivotLine > 0) {
    const updatedHighPivotCode = [
        '                    // Display edge data only if not already showing candles',
        '                    if (pivotEdgeData && !tradeConfig.showCandle) {',
        '                        const edgeOutput = formatEdgeData(pivotEdgeData, timeframes);',
        '                        console.log(edgeOutput[0]);',
        '                    }'
    ];
    content.splice(highPivotLine, 5, ...updatedHighPivotCode);
}

// Update the low pivot edge display section
if (lowPivotLine > 0) {
    // Adjust line number if high pivot section was updated
    if (highPivotLine > 0 && lowPivotLine > highPivotLine) {
        // No change in line count
    }
    
    const updatedLowPivotCode = [
        '                    // Display edge data only if not already showing candles',
        '                    if (pivotEdgeData && !tradeConfig.showCandle) {',
        '                        const edgeOutput = formatEdgeData(pivotEdgeData, timeframes);',
        '                        console.log(edgeOutput[0]);',
        '                    }'
    ];
    content.splice(lowPivotLine, 5, ...updatedLowPivotCode);
}

// Write the updated file
fs.writeFileSync(filePath, content.join('\n'), 'utf8');
console.log('File updated successfully!');
