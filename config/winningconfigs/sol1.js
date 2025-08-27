{
    interval: '1m',
    role: 'secondary',
    minSwingPctRange: { start: 0.1, end: 0.1, step: 0.1 },
    lookbackRange: { start: 3, end: 3, step: 1 },
    minLegBarsRange: { start: 1, end: 1, step: 1 },               
    weight: 1,
    oppositeRange: [false]
}, 
{
    interval: '30m',
    role: 'secondary',
    minSwingPctRange: { start: 0.7, end: 0.7, step: 0.1 },
    lookbackRange: { start: 1, end: 1, step: 1 },
    minLegBarsRange: { start: 5, end: 5, step: 1 },               
    weight: 1,
    oppositeRange: [false]
}, 

{
    interval: '1h',
    role: 'primary',
    minSwingPctRange: { start: 0.6, end: 0.6, step: 0.1 },
    lookbackRange: { start: 3, end: 3, step: 1 },
    minLegBarsRange: { start: 4, end: 4, step: 1 },               
    weight: 1,
    oppositeRange: [false]
}