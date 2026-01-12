// Nyquist plot drawing for loop shaping tool

// Format a number for LaTeX display with appropriate precision
function formatNumForLatex(x) {
    const absX = Math.abs(x);
    if (absX < 1e-6) return '0';
    if (absX >= 1000) {
        const exp = Math.floor(Math.log10(absX));
        const mantissa = x / Math.pow(10, exp);
        return `${mantissa.toFixed(2)} \\times 10^{${exp}}`;
    }
    if (absX >= 100) return x.toFixed(1);
    if (absX >= 10) return x.toFixed(2);
    if (absX >= 1) return x.toFixed(3);
    if (absX >= 0.01) return x.toFixed(4);
    const exp = Math.floor(Math.log10(absX));
    const mantissa = x / Math.pow(10, exp);
    return `${mantissa.toFixed(2)} \\times 10^{${exp}}`;
}

// Format angle in degrees for LaTeX display
function formatAngleDegrees(radians) {
    const deg = radians * 180 / Math.PI;
    // Normalize to -180 to 180 range
    let normalizedDeg = deg % 360;
    if (normalizedDeg > 180) normalizedDeg -= 360;
    if (normalizedDeg < -180) normalizedDeg += 360;
    return Math.round(normalizedDeg);
}

// Format s value and L(s) as LaTeX string for KaTeX rendering
// pointInfo contains: { s, indentation: { poleIm, theta }, L: { re, im } } or just { s, L }
function formatSValueLatex(pointInfo) {
    if (!pointInfo || !pointInfo.s) return '';

    const s = pointInfo.s;
    const indent = pointInfo.indentation;
    const L = pointInfo.L;

    let sLine = '';
    let lLine = '';

    // Format s value
    if (indent) {
        const poleIm = indent.poleIm;
        const theta = indent.theta;
        const thetaDeg = formatAngleDegrees(theta);

        // Format pole position (jω part)
        let poleStr;
        if (Math.abs(poleIm) < IMAG_AXIS_TOL) {
            poleStr = '';  // Origin pole, no jω term
        } else {
            poleStr = `${formatNumForLatex(poleIm)}j`;
        }

        // s = jω + ε∠θ°
        if (Math.abs(poleIm) < IMAG_AXIS_TOL) {
            sLine = `s &= \\varepsilon \\angle ${thetaDeg}^\\circ`;
        } else {
            sLine = `s &= ${poleStr} + \\varepsilon \\angle ${thetaDeg}^\\circ`;
        }
    } else {
        // Regular point on imaginary axis: s = jω
        const im = s.im;
        if (Math.abs(im) < 1e-8) {
            sLine = 's &= 0';
        } else {
            sLine = `s &= ${formatNumForLatex(im)}j`;
        }
    }

    // Format L(s) value
    if (L) {
        const mag = Math.sqrt(L.re * L.re + L.im * L.im);
        const phase = Math.atan2(L.im, L.re);
        const phaseDeg = formatAngleDegrees(phase);

        if (mag < 1e-10) {
            lLine = 'L(s) &= 0';
        } else if (mag > 1e4) {
            lLine = `L(s) &= \\infty \\angle ${phaseDeg}^\\circ`;
        } else {
            lLine = `L(s) &= ${formatNumForLatex(mag)} \\angle ${phaseDeg}^\\circ`;
        }
    }

    // Combine both lines
    if (sLine && lLine) {
        return `\\begin{aligned} ${sLine} \\\\ ${lLine} \\end{aligned}`;
    }
    return sLine;
}

// Animation state
let nyquistAnimationId = null;
let nyquistAnimationProgress = 0;  // Progress as fraction (0 to 1), preserved across updates
let nyquistAnimationPlaying = true;  // Whether animation is playing
let nyquistAnimationData = null;  // Store current animation data for seeking
let nyquistCurrentWrapperId = null;  // Current wrapper ID for UI updates
let nyquistAnimationSpeed = 1;  // Speed multiplier (0.25, 0.5, 1, 2, 4)
const nyquistSpeedOptions = [0.25, 0.5, 1, 2, 4];  // Available speed options

// Compression radius (adjustable via mouse wheel)
let nyquistCompressionRadius = 3;

// Draw Nyquist plot with z/(1+|z|/R) compression mapping
// When options.ctx/width/height are provided, draws to external context (for SVG export)
// Otherwise, draws to the canvas element specified by wrapperId/canvasId
// Animation is disabled when using external context
function drawNyquist(Lcompiled, imagAxisPoles, options) {
    options = options || {};
    const wrapperId = options.wrapperId || 'nyquist-wrapper';
    const canvasId = options.canvasId || 'nyquist-canvas';
    const R = nyquistCompressionRadius;
    const animate = options.animate !== false;
    const phaseMargins = options.phaseMargins || null;
    const showPhaseMarginArc = options.showPhaseMarginArc !== false;
    const gainMargins = options.gainMargins || null;
    const showGainMarginLine = options.showGainMarginLine !== false;

    let ctx, width, height, canvas;

    if (options.ctx && options.width && options.height) {
        // External context (SVG export)
        ctx = options.ctx;
        width = options.width;
        height = options.height;
        canvas = null;
    } else {
        // Canvas context
        let wrapper = document.getElementById(wrapperId);
        canvas = document.getElementById(canvasId);
        if (!wrapper || !canvas) return null;

        ctx = canvas.getContext('2d');

        width = wrapper.clientWidth;
        height = wrapper.clientHeight;

        if (width === 0 || height === 0) return null;

        canvas.width = width * devicePixelRatio;
        canvas.height = height * devicePixelRatio;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Calculate Nyquist data
    // Prefer shared analysis result (evaluated L(s) along the contour) to avoid duplicate evaluations.
    const analysis = options.analysis || (typeof computeNyquistAnalysis === 'function'
        ? computeNyquistAnalysis(Lcompiled, imagAxisPoles)
        : null);

    const nyquistData = calculateNyquistData(Lcompiled, imagAxisPoles, R, analysis);
    if (!nyquistData || nyquistData.points.length === 0) return null;

    // Calculate plot bounds (in compressed coordinates)
    const margin = 50;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;

    // The compressed mapping z/(1+|z|/R) maps everything to |z'| < R
    // So we need to show at least radius R
    const maxRadius = R * 1.1;  // Add small margin

    // Use same scale for both axes to maintain aspect ratio
    const scale = Math.min(plotWidth, plotHeight) / (2 * maxRadius);
    const centerX = width / 2;
    const centerY = height / 2;

    // Coordinate transforms (compressed space to canvas)
    const toCanvasX = (x) => centerX + x * scale;
    const toCanvasY = (y) => centerY - y * scale;  // Flip y for standard orientation

    // Draw polar grid
    drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R);

    // Draw phase margin arcs (if enabled and margins provided)
    if (showPhaseMarginArc && phaseMargins) {
        drawPhaseMarginArcs(ctx, centerX, centerY, scale, R, phaseMargins);
    }

    // Draw gain margin lines (if enabled and margins provided)
    if (showGainMarginLine && gainMargins) {
        drawGainMarginLines(ctx, centerX, centerY, scale, R, gainMargins);
    }

    // Draw critical point at -1
    const criticalX = toCanvasX(compressPoint(-1, 0, R).x);
    const criticalY = toCanvasY(compressPoint(-1, 0, R).y);
    drawCriticalPoint(ctx, criticalX, criticalY);

    // Draw Nyquist curve
    drawNyquistCurve(ctx, nyquistData.points, toCanvasX, toCanvasY, R);

    // Start animation if enabled (only when using canvas, not external context like SVG)
    if (animate && canvas) {
        startNyquistAnimation(canvas, ctx, nyquistData, toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, phaseMargins, showPhaseMarginArc, gainMargins, showGainMarginLine);
    }

    return nyquistData;
}

// Compress a complex point using z/(1+|z|/R) mapping
function compressPoint(re, im, R) {
    const mag = Math.sqrt(re * re + im * im);
    if (mag < 1e-10) return { x: 0, y: 0 };
    const factor = 1 / (1 + mag / R);
    return { x: re * factor, y: im * factor };
}

// Calculate Nyquist curve data with pole indentation.
// If a shared Nyquist analysis result is provided, it will be used to avoid duplicate L(s) evaluations.
function calculateNyquistData(Lcompiled, imagAxisPoles, R, analysis) {
    R = R || 10;

    // If no analysis was provided, compute it (fallback).
    const nyq = analysis || (typeof computeNyquistAnalysis === 'function'
        ? computeNyquistAnalysis(Lcompiled, imagAxisPoles)
        : null);

    return calculateNyquistDataFromAnalysis(nyq, R);
}

function calculateNyquistDataFromAnalysis(nyq, R) {
    if (!nyq || !nyq.points || nyq.points.length === 0) {
        return { points: [], cumulativeLength: [], totalLength: 0, hasOriginPole: false, poleFreqs: [] };
    }

    const allPoints = [];

    for (let p of nyq.points) {
        const re = p.L.re;
        const im = p.L.im;
        const compressed = compressPoint(re, im, R);

        allPoints.push({
            x: re, y: im,
            cx: compressed.x, cy: compressed.y,
            s: p.s,
            indentation: p.indentation || null
        });
    }

    // Calculate cumulative arc length (in compressed space)
    // Scale discontinuity threshold based on compression radius
    const discontinuityThreshold = Math.max(0.5, 0.3 * R);
    let cumulativeLength = [0];
    for (let i = 1; i < allPoints.length; i++) {
        const dx = allPoints[i].cx - allPoints[i - 1].cx;
        const dy = allPoints[i].cy - allPoints[i - 1].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampedDist = dist > discontinuityThreshold ? 0 : dist;
        cumulativeLength.push(cumulativeLength[i - 1] + clampedDist);
    }
    const totalLength = cumulativeLength[cumulativeLength.length - 1];

    return {
        points: allPoints,
        cumulativeLength,
        totalLength,
        hasOriginPole: !!nyq.hasOriginPole,
        poleFreqs: nyq.poleFreqs || []
    };
}

// Draw polar grid with unit circle highlighted
function drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R) {
    // Draw radial lines (every 15 degrees)
    for (let deg = 0; deg < 180; deg += 15) {
        const angle = deg * Math.PI / 180;
        const dx = Math.cos(angle) * maxRadius * scale;
        const dy = Math.sin(angle) * maxRadius * scale;

        if (deg % 45 === 0) {
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 1;
        } else {
            ctx.strokeStyle = '#e8e8e8';
            ctx.lineWidth = 0.5;
        }

        ctx.beginPath();
        ctx.moveTo(centerX - dx, centerY + dy);
        ctx.lineTo(centerX + dx, centerY - dy);
        ctx.stroke();
    }

    // Draw angle labels at 45 degree intervals (on the outer edge)
    ctx.fillStyle = '#333333';
    ctx.font = '14px Consolas, monospace';
    const labelRadius = maxRadius * scale + 16;

    const angleLabels = [
        { deg: 0, label: 'Re' },
        { deg: 45, label: '45°' },
        { deg: 90, label: 'Im' },
        { deg: 135, label: '135°' },
        { deg: 180, label: '180°' },
        { deg: -45, label: '-45°' },
        { deg: -90, label: '-90°' },
        { deg: -135, label: '-135°' }
    ];

    for (let item of angleLabels) {
        const angle = item.deg * Math.PI / 180;
        const lx = centerX + Math.cos(angle) * labelRadius;
        const ly = centerY - Math.sin(angle) * labelRadius;

        if (Math.abs(item.deg) === 90) {
            ctx.textAlign = 'center';
            ctx.textBaseline = item.deg > 0 ? 'bottom' : 'top';
        } else if (item.deg === 0 || item.deg === 180) {
            ctx.textAlign = item.deg === 0 ? 'left' : 'right';
            ctx.textBaseline = 'middle';
        } else if (item.deg > 0) {
            ctx.textAlign = item.deg < 90 ? 'left' : 'right';
            ctx.textBaseline = 'bottom';
        } else {
            ctx.textAlign = item.deg > -90 ? 'left' : 'right';
            ctx.textBaseline = 'top';
        }

        ctx.fillText(item.label, lx, ly);
    }

    // Draw concentric circles: gain margin radii (0.5, 2) in green, others at 10x intervals
    const gainMarginRadii = [0.5, 2];
    const standardRadii = [];
    let multiplier = 0.1;
    while (multiplier <= 1e12) {
        const compressedR = multiplier / (1 + multiplier / R);
        if (compressedR > maxRadius) break;
        standardRadii.push(multiplier);
        multiplier *= 10;
    }

    const allRadii = [...new Set([...gainMarginRadii, ...standardRadii])].sort((a, b) => a - b);
    const minGridSpacing = 3;
    const radiusPixelPositions = [];
    let lastPixelRadius = 0;

    for (const r of allRadii) {
        const compressedR = r / (1 + r / R);
        if (compressedR > maxRadius) continue;
        const pixelRadius = compressedR * scale;
        const spacing = pixelRadius - lastPixelRadius;
        if (radiusPixelPositions.length === 0 || spacing >= minGridSpacing) {
            const labelText = r >= 1 ? r.toString() : r.toFixed(1);
            const isGainMargin = gainMarginRadii.includes(r);
            radiusPixelPositions.push({ r, pixelRadius, labelText, isGainMargin });
            lastPixelRadius = pixelRadius;
        }
    }

    for (const { r, pixelRadius, isGainMargin } of radiusPixelPositions) {
        if (Math.abs(r - 1) < 0.001) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
        } else if (isGainMargin) {
            ctx.strokeStyle = '#90c090';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
        } else {
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.arc(centerX, centerY, pixelRadius, 0, 2 * Math.PI);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw radius labels (prioritize values closer to 1)
    const minLabelSpacing = 25;
    const labelCandidates = radiusPixelPositions
        .filter(item => Math.abs(item.r - 1) >= 0.001)
        .map(item => ({ ...item, distFrom1: Math.abs(Math.log10(item.r)) }))
        .sort((a, b) => a.distFrom1 - b.distFrom1);

    const occupiedRanges = [];
    const labelsToShow = [];
    for (const item of labelCandidates) {
        const labelX = centerX + item.pixelRadius;
        const halfWidth = minLabelSpacing / 2;
        const conflicts = occupiedRanges.some(range =>
            labelX + halfWidth > range.left && labelX - halfWidth < range.right
        );
        if (!conflicts) {
            labelsToShow.push(item);
            occupiedRanges.push({ left: labelX - halfWidth, right: labelX + halfWidth });
        }
    }

    labelsToShow.sort((a, b) => a.pixelRadius - b.pixelRadius);
    let labelAbove = true;
    ctx.fillStyle = '#333333';
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    for (const item of labelsToShow) {
        const labelX = centerX + item.pixelRadius;
        ctx.textBaseline = labelAbove ? 'top' : 'bottom';
        const labelY = labelAbove ? centerY + 4 : centerY - 4;
        ctx.fillText(item.labelText, labelX, labelY);
        labelAbove = !labelAbove;
    }

    // Draw axes
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;

    // Real axis
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius * scale, centerY);
    ctx.lineTo(centerX + maxRadius * scale, centerY);
    ctx.stroke();

    // Imaginary axis
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - maxRadius * scale);
    ctx.lineTo(centerX, centerY + maxRadius * scale);
    ctx.stroke();
}

// Draw critical point at -1
function drawCriticalPoint(ctx, x, y) {
    ctx.strokeStyle = '#dc3545';
    ctx.lineWidth = 2;
    const size = 5;

    // Draw X mark
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();

    // Label (left side of the x mark)
    ctx.fillStyle = '#dc3545';
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('-1', x - size - 4, y);
}

// Draw phase margin arcs on the unit circle
// phaseMargins: array of { frequency, margin, phaseAtCrossover } from calculateStabilityMargins
// Shows arc from -180° to the phase at gain crossover
function drawPhaseMarginArcs(ctx, centerX, centerY, scale, R, phaseMargins) {
    if (!phaseMargins || phaseMargins.length === 0) return;

    // Unit circle in compressed coordinates: radius = 1 / (1 + 1/R) = R / (R + 1)
    const compressedUnitRadius = R / (R + 1);
    const pixelRadius = compressedUnitRadius * scale;

    // Stability check is now done in main.js before passing phaseMargins
    // phaseMargins is only passed when closed-loop system is stable (Z = N + P = 0)

    ctx.save();
    ctx.strokeStyle = '#000000';  // Black for stable system (matching Bode)
    ctx.lineWidth = 2;

    for (const pm of phaseMargins) {
        // Phase at gain crossover (in degrees)
        const phaseAtGc = pm.phaseAtCrossover;

        // Reference phase line (typically -180° or -180° + n*360°)
        const refPhase = pm.referencePhase !== undefined ? pm.referencePhase : -180;

        // Convert phases to canvas angles
        // Standard math: angle = phase * π/180, measured counter-clockwise from +x
        // Canvas: y is flipped, so we negate the angle
        const refAngle = -refPhase * Math.PI / 180;  // Reference angle (-180° → π)
        const gcAngle = -phaseAtGc * Math.PI / 180;  // Gain crossover angle

        // Draw arc from reference phase to phase at gain crossover
        ctx.beginPath();
        let startAngle = refAngle;
        let endAngle = gcAngle;

        // Normalize angles to be close to each other
        while (endAngle - startAngle > Math.PI) endAngle -= 2 * Math.PI;
        while (startAngle - endAngle > Math.PI) endAngle += 2 * Math.PI;

        // Draw arc (counterclockwise if endAngle > startAngle)
        const counterClockwise = endAngle < startAngle;
        ctx.arc(centerX, centerY, pixelRadius, startAngle, endAngle, counterClockwise);
        ctx.stroke();

        // Draw phase margin value at the midpoint of the arc, outside the circle
        const midAngle = (startAngle + endAngle) / 2;
        const labelOffset = 4;  // Small gap from the arc
        const labelRadius = pixelRadius + labelOffset;
        const labelX = centerX + labelRadius * Math.cos(midAngle);
        const labelY = centerY + labelRadius * Math.sin(midAngle);

        // Format the phase margin value
        const pmValue = Math.round(pm.margin);
        const labelText = 'PM=' + pmValue + '°';

        // Draw rotated text radially (perpendicular to the arc)
        ctx.save();
        ctx.translate(labelX, labelY);
        // Rotate so text is along the radial direction
        let textAngle = midAngle;
        // Ensure text is not upside down (rotate 180° if needed)
        // When flipped, we also need to swap alignment direction
        const isFlipped = midAngle > Math.PI / 2 || midAngle < -Math.PI / 2;
        if (isFlipped) {
            textAngle += Math.PI;
        }
        ctx.rotate(textAngle);

        ctx.fillStyle = '#000000';
        ctx.font = '12px Consolas, monospace';
        // Right-align so "°" is near the arc, text extends outward
        // When flipped, use 'right' to put "°" at anchor; otherwise use 'left'
        ctx.textAlign = isFlipped ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 0, 0);
        ctx.restore();
    }

    ctx.restore();
}

// Draw gain margin lines on the negative real axis
// gainMargins: array of { frequency, margin, gainAtCrossover } from calculateStabilityMargins
// Shows line from L(jωpc) to -1 on the negative real axis
function drawGainMarginLines(ctx, centerX, centerY, scale, R, gainMargins) {
    if (!gainMargins || gainMargins.length === 0) return;

    // Stability check is now done in main.js before passing gainMargins
    // gainMargins is only passed when closed-loop system is stable (Z = N + P = 0)

    // Filter to finite gain margins only (exclude infinite GM)
    const finiteGMs = gainMargins.filter(gm => isFinite(gm.margin) && Math.abs(gm.margin) < 1000);
    if (finiteGMs.length === 0) return;

    // Find the smallest positive and smallest negative (or largest negative = closest to 0) gain margins
    const positiveGMs = finiteGMs.filter(gm => gm.margin > 0);
    const negativeGMs = finiteGMs.filter(gm => gm.margin < 0);

    // Get the one with smallest margin in each direction
    let gmToShow = [];
    if (positiveGMs.length > 0) {
        const minPositive = positiveGMs.reduce((a, b) => a.margin < b.margin ? a : b);
        gmToShow.push(minPositive);
    }
    if (negativeGMs.length > 0) {
        const maxNegative = negativeGMs.reduce((a, b) => a.margin > b.margin ? a : b);
        gmToShow.push(maxNegative);
    }

    if (gmToShow.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;

    for (const gm of gmToShow) {
        // gainAtCrossover is in dB, margin is -gainAtCrossover
        // |L(jωpc)| = 10^(gainAtCrossover/20)
        const gainLinear = Math.pow(10, gm.gainAtCrossover / 20);
        // L(jωpc) is on negative real axis: L = -gainLinear
        const Lvalue = -gainLinear;

        // Compress the points
        const LCompressed = compressPoint(Lvalue, 0, R);
        const criticalCompressed = compressPoint(-1, 0, R);

        // Convert to canvas coordinates
        const Lx = centerX + LCompressed.x * scale;
        const Ly = centerY - LCompressed.y * scale;
        const critX = centerX + criticalCompressed.x * scale;
        const critY = centerY - criticalCompressed.y * scale;

        // Draw line from L(jωpc) to -1
        ctx.beginPath();
        ctx.moveTo(Lx, Ly);
        ctx.lineTo(critX, critY);
        ctx.stroke();

        // Draw label with GM value in dB
        const gmValue = Math.round(gm.margin);
        const labelText = 'GM=' + (gmValue >= 0 ? '+' : '') + gmValue + 'dB';

        // Position label at midpoint, slightly above the line
        const midX = (Lx + critX) / 2;
        const midY = (Ly + critY) / 2 - 1;  // Above the line

        ctx.fillStyle = '#000000';
        ctx.font = '12px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labelText, midX, midY);
    }

    ctx.restore();
}

// Draw the Nyquist curve
// R: compression radius, used to scale discontinuity threshold
function drawNyquistCurve(ctx, points, toCanvasX, toCanvasY, R) {
    if (points.length < 2) return;

    // Scale discontinuity threshold based on compression radius
    // In compressed space, points on the large semicircle (pole indentation) have spacing ~πR/N
    const discontinuityThreshold = Math.max(0.5, 0.3 * (R || 3));

    ctx.strokeStyle = '#0088aa';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(toCanvasX(points[0].cx), toCanvasY(points[0].cy));

    for (let i = 1; i < points.length; i++) {
        // Skip if points are too far apart (discontinuity)
        let dx = points[i].cx - points[i - 1].cx;
        let dy = points[i].cy - points[i - 1].cy;
        if (Math.sqrt(dx * dx + dy * dy) > discontinuityThreshold) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(toCanvasX(points[i].cx), toCanvasY(points[i].cy));
        } else {
            ctx.lineTo(toCanvasX(points[i].cx), toCanvasY(points[i].cy));
        }
    }
    ctx.stroke();

    // Draw arrows to indicate direction (at a few points along the curve)
    const arrowPositions = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9];
    for (let pos of arrowPositions) {
        const idx = Math.floor(pos * points.length);
        if (idx > 0 && idx < points.length - 1) {
            drawArrow(ctx, points, idx, toCanvasX, toCanvasY);
        }
    }
}

// Draw arrow at a point along the curve
function drawArrow(ctx, points, idx, toCanvasX, toCanvasY) {
    const p0 = points[Math.max(0, idx - 1)];
    const p1 = points[idx];

    const dx = p1.cx - p0.cx;
    const dy = p1.cy - p0.cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;

    const x = toCanvasX(p1.cx);
    const y = toCanvasY(p1.cy);

    // Direction of arrow (in canvas coordinates)
    const dirX = dx / len;
    const dirY = -dy / len;  // Flip y

    const arrowSize = 6;
    const angle = Math.PI / 6;

    ctx.fillStyle = '#0088aa';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
        x - arrowSize * (dirX * Math.cos(angle) - dirY * Math.sin(angle)),
        y - arrowSize * (dirY * Math.cos(angle) + dirX * Math.sin(angle))
    );
    ctx.lineTo(
        x - arrowSize * (dirX * Math.cos(-angle) - dirY * Math.sin(-angle)),
        y - arrowSize * (dirY * Math.cos(-angle) + dirX * Math.sin(-angle))
    );
    ctx.closePath();
    ctx.fill();
}

// Find point position at a given arc length using binary search
function getPointAtArcLength(points, cumulativeLength, targetLength) {
    // Binary search to find the segment containing targetLength
    let lo = 0, hi = cumulativeLength.length - 1;
    while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulativeLength[mid] <= targetLength) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    // Interpolate between points[lo] and points[hi]
    const segmentStart = cumulativeLength[lo];
    const segmentEnd = cumulativeLength[hi];
    const segmentLength = segmentEnd - segmentStart;

    if (segmentLength < 1e-10) {
        return {
            cx: points[lo].cx,
            cy: points[lo].cy,
            x: points[lo].x,
            y: points[lo].y,
            s: points[lo].s,
            indentation: points[lo].indentation
        };
    }

    const t = (targetLength - segmentStart) / segmentLength;
    const cx = points[lo].cx + t * (points[hi].cx - points[lo].cx);
    const cy = points[lo].cy + t * (points[hi].cy - points[lo].cy);

    // Interpolate L(s) value (uncompressed coordinates)
    const x = points[lo].x + t * (points[hi].x - points[lo].x);
    const y = points[lo].y + t * (points[hi].y - points[lo].y);

    // Interpolate s value (complex number)
    let s = null;
    if (points[lo].s && points[hi].s) {
        const sRe = points[lo].s.re + t * (points[hi].s.re - points[lo].s.re);
        const sIm = points[lo].s.im + t * (points[hi].s.im - points[lo].s.im);
        s = math.complex(sRe, sIm);
    } else if (points[lo].s) {
        s = points[lo].s;
    }

    // Interpolate indentation info (if both points have it with same pole)
    let indentation = null;
    if (points[lo].indentation && points[hi].indentation &&
        Math.abs(points[lo].indentation.poleIm - points[hi].indentation.poleIm) < 1e-6) {
        const theta = points[lo].indentation.theta + t * (points[hi].indentation.theta - points[lo].indentation.theta);
        indentation = { poleIm: points[lo].indentation.poleIm, theta: theta };
    } else if (points[lo].indentation) {
        indentation = points[lo].indentation;
    }

    return { cx, cy, x, y, s, indentation };
}

// Start animation of moving point on the curve
function startNyquistAnimation(canvas, ctx, nyquistData, toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, phaseMargins, showPhaseMarginArc, gainMargins, showGainMarginLine) {
    // Stop any existing animation (preserves progress in nyquistAnimationProgress)
    stopNyquistAnimation();

    const points = nyquistData.points;
    const cumulativeLength = nyquistData.cumulativeLength;
    const totalLength = nyquistData.totalLength;

    if (points.length < 2 || totalLength < 1e-10) return;

    // Store animation data for seeking and UI updates
    nyquistAnimationData = {
        canvas, ctx, points, cumulativeLength, totalLength,
        toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R,
        phaseMargins: phaseMargins || null,
        showPhaseMarginArc: showPhaseMarginArc !== false,
        gainMargins: gainMargins || null,
        showGainMarginLine: showGainMarginLine !== false
    };
    nyquistCurrentWrapperId = wrapperId;

    // Calculate base speed to complete one cycle in approximately 3 seconds (180 frames at 60fps)
    const cycleDuration = 180;  // frames
    const baseSpeed = totalLength / cycleDuration;

    // Initialize current arc length from preserved progress (0 to 1 fraction)
    let currentArcLength = nyquistAnimationProgress * totalLength;

    // Setup UI controls
    setupNyquistAnimationControls(wrapperId);
    updatePlayButtonIcon(wrapperId, nyquistAnimationPlaying);
    updateSeekBar(wrapperId, nyquistAnimationProgress);

    function animate() {
        // Check if canvas is still valid and visible
        if (!canvas || !canvas.parentElement || canvas.width === 0 || canvas.height === 0) {
            stopNyquistAnimation();
            return;
        }

        // Check if wrapper is still in DOM and visible
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper || wrapper.clientWidth === 0 || wrapper.clientHeight === 0) {
            stopNyquistAnimation();
            return;
        }

        try {
            // Get current arc length from global progress (may have been updated by seek bar)
            currentArcLength = nyquistAnimationProgress * totalLength;

            // Render current frame
            renderNyquistFrame(canvas, ctx, points, cumulativeLength,
                toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, currentArcLength);

            // Update position based on arc length (uniform speed) only if playing
            if (nyquistAnimationPlaying) {
                currentArcLength += baseSpeed * nyquistAnimationSpeed;
                if (currentArcLength >= totalLength) {
                    currentArcLength = currentArcLength - totalLength;
                }

                // Update global progress (0 to 1 fraction) for preservation across updates
                nyquistAnimationProgress = currentArcLength / totalLength;

                // Update seek bar
                updateSeekBar(wrapperId, nyquistAnimationProgress);
            }

            nyquistAnimationId = requestAnimationFrame(animate);
        } catch (e) {
            // If any error occurs, stop animation
            console.log('Nyquist animation error:', e);
            stopNyquistAnimation();
        }
    }

    animate();
}

// Render a single frame of the Nyquist animation
function renderNyquistFrame(canvas, ctx, points, cumulativeLength,
    toCanvasX, toCanvasY, centerX, centerY, scale, maxRadius, R, wrapperId, currentArcLength) {

    // Redraw the entire plot
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const width = canvas.width / devicePixelRatio;
    const height = canvas.height / devicePixelRatio;

    // Clear and redraw background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Redraw grid
    drawPolarGrid(ctx, centerX, centerY, scale, maxRadius, R);

    // Redraw phase margin arcs (get from stored animation data)
    if (nyquistAnimationData && nyquistAnimationData.showPhaseMarginArc && nyquistAnimationData.phaseMargins) {
        drawPhaseMarginArcs(ctx, centerX, centerY, scale, R, nyquistAnimationData.phaseMargins);
    }

    // Redraw gain margin lines (get from stored animation data)
    if (nyquistAnimationData && nyquistAnimationData.showGainMarginLine && nyquistAnimationData.gainMargins) {
        drawGainMarginLines(ctx, centerX, centerY, scale, R, nyquistAnimationData.gainMargins);
    }

    // Redraw critical point
    const criticalCompressed = compressPoint(-1, 0, R);
    const criticalX = toCanvasX(criticalCompressed.x);
    const criticalY = toCanvasY(criticalCompressed.y);
    drawCriticalPoint(ctx, criticalX, criticalY);

    // Redraw curve
    drawNyquistCurve(ctx, points, toCanvasX, toCanvasY, R);

    // Get interpolated point position at current arc length
    const p = getPointAtArcLength(points, cumulativeLength, currentArcLength);
    const px = toCanvasX(p.cx);
    const py = toCanvasY(p.cy);

    // Draw point with glow effect
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0, 136, 170, 0.3)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#0088aa';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Display current s value and L(s) using KaTeX overlay
    const sOverlayId = wrapperId === 'narrow-nyquist-wrapper' ? 'narrow-nyquist-s-value-overlay' : 'nyquist-s-value-overlay';
    const sOverlay = document.getElementById(sOverlayId);
    if (sOverlay && p.s) {
        // p.x and p.y are the uncompressed L(s) values (real and imaginary parts)
        const L = (p.x !== undefined && p.y !== undefined) ? { re: p.x, im: p.y } : null;
        const latexStr = formatSValueLatex({ s: p.s, indentation: p.indentation, L: L });
        if (latexStr && typeof katex !== 'undefined') {
            try {
                katex.render(latexStr, sOverlay, { throwOnError: false });
            } catch (e) {
                sOverlay.textContent = latexStr;
            }
        }
    }

    // Update Pole-Zero Map to show current s point
    if (typeof updatePolePlot === 'function' && wrapperId === 'nyquist-wrapper') {
        updatePolePlot();
    }
}

// Setup play/pause button, seek bar, and speed button event handlers
function setupNyquistAnimationControls(wrapperId) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const playBtnId = isNarrow ? 'narrow-nyquist-play-btn' : 'nyquist-play-btn';
    const seekBarId = isNarrow ? 'narrow-nyquist-seek-bar' : 'nyquist-seek-bar';
    const speedBtnId = isNarrow ? 'narrow-nyquist-speed-btn' : 'nyquist-speed-btn';

    const playBtn = document.getElementById(playBtnId);
    const seekBar = document.getElementById(seekBarId);
    const speedBtn = document.getElementById(speedBtnId);

    if (playBtn && !playBtn._nyquistSetup) {
        playBtn._nyquistSetup = true;
        playBtn.addEventListener('click', () => {
            nyquistAnimationPlaying = !nyquistAnimationPlaying;
            updatePlayButtonIcon(wrapperId, nyquistAnimationPlaying);
        });
    }

    if (seekBar && !seekBar._nyquistSetup) {
        seekBar._nyquistSetup = true;

        // Update progress when user drags the seek bar (Shoelace sl-range uses 'sl-input' event)
        seekBar.addEventListener('sl-input', (e) => {
            const value = parseFloat(e.target.value);
            nyquistAnimationProgress = value / 1000;

            // If paused, render the current frame immediately
            if (!nyquistAnimationPlaying && nyquistAnimationData) {
                const d = nyquistAnimationData;
                const currentArcLength = nyquistAnimationProgress * d.totalLength;
                renderNyquistFrame(d.canvas, d.ctx, d.points, d.cumulativeLength,
                    d.toCanvasX, d.toCanvasY, d.centerX, d.centerY, d.scale, d.maxRadius, d.R,
                    nyquistCurrentWrapperId, currentArcLength);
            }
        });
    }

    if (speedBtn && !speedBtn._nyquistSetup) {
        speedBtn._nyquistSetup = true;
        speedBtn.addEventListener('click', () => {
            cycleNyquistSpeed();
            updateSpeedButtonLabel(wrapperId);
        });
    }

    // Initialize speed button label
    updateSpeedButtonLabel(wrapperId);
}

// Cycle through speed options
function cycleNyquistSpeed() {
    const currentIndex = nyquistSpeedOptions.indexOf(nyquistAnimationSpeed);
    const nextIndex = (currentIndex + 1) % nyquistSpeedOptions.length;
    nyquistAnimationSpeed = nyquistSpeedOptions[nextIndex];
}

// Update speed button label
function updateSpeedButtonLabel(wrapperId) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const speedBtnId = isNarrow ? 'narrow-nyquist-speed-btn' : 'nyquist-speed-btn';
    const speedBtn = document.getElementById(speedBtnId);

    if (speedBtn) {
        speedBtn.textContent = nyquistAnimationSpeed + 'x';
    }
}

// Update play/pause button icon
function updatePlayButtonIcon(wrapperId, isPlaying) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const playBtnId = isNarrow ? 'narrow-nyquist-play-btn' : 'nyquist-play-btn';
    const playBtn = document.getElementById(playBtnId);

    if (playBtn) {
        // Shoelace sl-icon-button uses 'name' attribute for icon
        playBtn.name = isPlaying ? 'pause-fill' : 'play-fill';
    }
}

// Update seek bar position
function updateSeekBar(wrapperId, progress) {
    const isNarrow = wrapperId === 'narrow-nyquist-wrapper';
    const seekBarId = isNarrow ? 'narrow-nyquist-seek-bar' : 'nyquist-seek-bar';
    const seekBar = document.getElementById(seekBarId);

    if (seekBar && document.activeElement !== seekBar) {
        seekBar.value = Math.round(progress * 1000);
    }
}

// Stop animation
function stopNyquistAnimation() {
    if (nyquistAnimationId !== null) {
        cancelAnimationFrame(nyquistAnimationId);
        nyquistAnimationId = null;
    }
}

// Toggle play/pause (can be called externally)
function toggleNyquistAnimation() {
    nyquistAnimationPlaying = !nyquistAnimationPlaying;
    if (nyquistCurrentWrapperId) {
        updatePlayButtonIcon(nyquistCurrentWrapperId, nyquistAnimationPlaying);
    }
}

// Seek to a specific position (0-1)
function seekNyquistAnimation(progress) {
    nyquistAnimationProgress = Math.max(0, Math.min(1, progress));
    if (nyquistCurrentWrapperId) {
        updateSeekBar(nyquistCurrentWrapperId, nyquistAnimationProgress);
    }
}

// Redraw Nyquist without animation (for static display)
function drawNyquistStatic(Lcompiled, imagAxisPoles, options) {
    options = options || {};
    options.animate = false;
    return drawNyquist(Lcompiled, imagAxisPoles, options);
}

// Get the current s value from Nyquist animation for Pole-Zero Map display
// Returns { re, im, indentation } where indentation is { poleIm, theta } if on a pole indentation
function getCurrentNyquistSValue() {
    if (!nyquistAnimationData) return null;

    const d = nyquistAnimationData;
    const currentArcLength = nyquistAnimationProgress * d.totalLength;
    const p = getPointAtArcLength(d.points, d.cumulativeLength, currentArcLength);

    if (p && p.s) {
        return { re: p.s.re, im: p.s.im, indentation: p.indentation || null };
    }
    return null;
}
