// Step response plotting functionality

// ============================================================================
// Constants
// ============================================================================

const STEP_PLOT = {
    MARGINS: { left: 60, right: 20, top: 20, bottom: 50 },
    FONT: '14px Consolas, monospace',
    COLORS: {
        riseTime: '#0066cc',
        settling: '#009933',
        overshoot: '#cc3300'
    }
};

// ============================================================================
// Step Time Calculation
// ============================================================================

function getStepTimeMax() {
    return stepOptions.autoTime ? calculateAutoStepTime() : stepOptions.timeMax;
}

function calculateAutoStepTime() {
    const DEFAULT_TIME = 20;

    try {
        const clPoles = window.lastPoles || [];
        if (clPoles.length === 0) return DEFAULT_TIME;

        const isStable = clPoles.every(p => p.re < 1e-10);
        if (!isStable) return DEFAULT_TIME;

        let dominantRe = null;
        for (const p of clPoles) {
            if (p.re < -1e-10) {
                const absRe = Math.abs(p.re);
                if (dominantRe === null || absRe < dominantRe) {
                    dominantRe = absRe;
                }
            }
        }

        if (dominantRe === null || dominantRe < 1e-10) return DEFAULT_TIME;

        return Math.max(0.1, Math.min(1000, stepOptions.autoTimeMultiplier / dominantRe));
    } catch (e) {
        console.log('Auto step time calculation error:', e);
        return DEFAULT_TIME;
    }
}

// ============================================================================
// Performance Metrics Calculation
// ============================================================================

function calculateStepMetrics(time, yT, finalValue = 1) {
    if (!time || !yT || time.length < 2) return null;

    const n = time.length;
    const tol = 0.05;
    const yFinal = finalValue;

    // Rise time (10% to 90%)
    const y10 = 0.1 * yFinal, y90 = 0.9 * yFinal;
    let t10 = null, t90 = null;

    for (let i = 1; i < n; i++) {
        if (!isFinite(yT[i]) || !isFinite(yT[i - 1])) continue;
        if (t10 === null && yT[i - 1] < y10 && yT[i] >= y10) {
            t10 = time[i - 1] + (y10 - yT[i - 1]) / (yT[i] - yT[i - 1]) * (time[i] - time[i - 1]);
        }
        if (t90 === null && yT[i - 1] < y90 && yT[i] >= y90) {
            t90 = time[i - 1] + (y90 - yT[i - 1]) / (yT[i] - yT[i - 1]) * (time[i] - time[i - 1]);
        }
    }

    // Peak value
    let yPeak = yT[0], tPeak = time[0];
    for (let i = 0; i < n; i++) {
        if (isFinite(yT[i]) && yT[i] > yPeak) {
            yPeak = yT[i];
            tPeak = time[i];
        }
    }

    // Overshoot
    const overshoot = (yPeak > yFinal && yFinal > 0)
        ? ((yPeak - yFinal) / yFinal) * 100
        : (yPeak <= yFinal ? 0 : null);

    // Settling time
    const upperBound = yFinal * (1 + tol);
    const lowerBound = yFinal * (1 - tol);
    let settlingTime = null;

    let lastOutsideIdx = -1;
    for (let i = n - 1; i >= 0; i--) {
        if (isFinite(yT[i]) && (yT[i] > upperBound || yT[i] < lowerBound)) {
            lastOutsideIdx = i;
            break;
        }
    }

    if (lastOutsideIdx === -1) {
        for (let i = 0; i < n; i++) {
            if (isFinite(yT[i]) && yT[i] >= lowerBound && yT[i] <= upperBound) {
                settlingTime = time[i];
                break;
            }
        }
    } else if (lastOutsideIdx < n - 1) {
        const i = lastOutsideIdx, j = i + 1;
        if (isFinite(yT[i]) && isFinite(yT[j])) {
            const bound = yT[i] > upperBound ? upperBound : lowerBound;
            settlingTime = time[i] + (bound - yT[i]) / (yT[j] - yT[i]) * (time[j] - time[i]);
        } else {
            settlingTime = time[j];
        }
    }

    return {
        riseTime: (t10 !== null && t90 !== null) ? (t90 - t10) : null,
        riseTimeT10: t10,
        riseTimeT90: t90,
        settlingTime,
        overshoot,
        peakTime: tPeak,
        peakValue: yPeak,
        finalValue: yFinal
    };
}

// ============================================================================
// Metrics Drawing
// ============================================================================

function drawStepMetrics(ctx, metrics, t2x, y2y, plotInfo) {
    const { leftMargin, topMargin, plotWidth, plotHeight, tMax } = plotInfo;
    const { finalValue: yFinal, riseTime, riseTimeT10, riseTimeT90, settlingTime, overshoot, peakTime, peakValue } = metrics;
    const { riseTime: riseColor, settling: settleColor, overshoot: osColor } = STEP_PLOT.COLORS;

    ctx.save();
    ctx.beginPath();
    ctx.rect(leftMargin, topMargin, plotWidth, plotHeight);
    ctx.clip();

    // Tolerance band (±5%)
    const yUpper = y2y(yFinal * 1.05);
    const yLower = y2y(yFinal * 0.95);
    if (yUpper >= topMargin && yLower <= topMargin + plotHeight) {
        ctx.fillStyle = 'rgba(0, 153, 51, 0.1)';
        ctx.fillRect(leftMargin, yUpper, plotWidth, yLower - yUpper);
        ctx.font = STEP_PLOT.FONT;
        ctx.fillStyle = settleColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('±5%', leftMargin + plotWidth - 4, yUpper - 2);
    }

    // Rise time indicators
    if (riseTime !== null && riseTimeT10 !== null && riseTimeT90 !== null) {
        const py10 = y2y(0.1 * yFinal), py90 = y2y(0.9 * yFinal);
        const px10 = t2x(riseTimeT10), px90 = t2x(riseTimeT90);

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = riseColor;

        // Horizontal and vertical lines at 10% and 90%
        for (const [py, px] of [[py10, px10], [py90, px90]]) {
            if (py >= topMargin && py <= topMargin + plotHeight && px <= leftMargin + plotWidth) {
                ctx.beginPath();
                ctx.moveTo(leftMargin, py);
                ctx.lineTo(px, py);
                ctx.moveTo(px, py);
                ctx.lineTo(px, topMargin + plotHeight);
                ctx.stroke();
            }
        }

        // Tr arrow on y=0 axis
        const arrowY = y2y(0);
        if (px10 >= leftMargin && px90 <= leftMargin + plotWidth && arrowY >= topMargin && arrowY <= topMargin + plotHeight) {
            ctx.setLineDash([]);
            ctx.fillStyle = riseColor;

            ctx.beginPath();
            ctx.moveTo(px10, arrowY);
            ctx.lineTo(px90, arrowY);
            ctx.stroke();

            // Arrow heads
            const s = 4;
            ctx.beginPath();
            ctx.moveTo(px10, arrowY);
            ctx.lineTo(px10 + s, arrowY - s);
            ctx.lineTo(px10 + s, arrowY + s);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(px90, arrowY);
            ctx.lineTo(px90 - s, arrowY - s);
            ctx.lineTo(px90 - s, arrowY + s);
            ctx.closePath();
            ctx.fill();

            ctx.font = STEP_PLOT.FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Tr', (px10 + px90) / 2, arrowY + 3);
        }
    }

    // Settling time line
    if (settlingTime !== null && settlingTime <= tMax) {
        const xSettle = t2x(settlingTime);
        ctx.strokeStyle = settleColor;
        ctx.setLineDash([6, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xSettle, topMargin);
        ctx.lineTo(xSettle, topMargin + plotHeight);
        ctx.stroke();
    }

    // Overshoot indicator
    if (overshoot > 0.1 && peakTime <= tMax) {
        const xPeak = t2x(peakTime);
        const yPeakPx = y2y(peakValue), yFinalPx = y2y(yFinal);
        const s = 4;

        ctx.strokeStyle = osColor;
        ctx.fillStyle = osColor;
        ctx.setLineDash([]);
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(xPeak, yFinalPx);
        ctx.lineTo(xPeak, yPeakPx);
        ctx.stroke();

        // Arrow heads
        ctx.beginPath();
        ctx.moveTo(xPeak, yFinalPx);
        ctx.lineTo(xPeak - s, yFinalPx - s);
        ctx.lineTo(xPeak + s, yFinalPx - s);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(xPeak, yPeakPx);
        ctx.lineTo(xPeak - s, yPeakPx + s);
        ctx.lineTo(xPeak + s, yPeakPx + s);
        ctx.closePath();
        ctx.fill();

        ctx.font = STEP_PLOT.FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Mp', xPeak + 6, (yPeakPx + yFinalPx) / 2);
    }

    ctx.restore();
    ctx.setLineDash([]);

    // Labels outside clip region
    ctx.font = STEP_PLOT.FONT;

    if (settlingTime !== null && settlingTime <= tMax) {
        ctx.fillStyle = settleColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Ts', t2x(settlingTime), topMargin + plotHeight + 4);
    }

    if (riseTime !== null) {
        ctx.fillStyle = riseColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const py10 = y2y(0.1 * yFinal), py90 = y2y(0.9 * yFinal);
        if (py10 >= topMargin && py10 <= topMargin + plotHeight) ctx.fillText('0.1', leftMargin - 4, py10);
        if (py90 >= topMargin && py90 <= topMargin + plotHeight) ctx.fillText('0.9', leftMargin - 4, py90);
    }

    // Legend box
    drawMetricsLegend(ctx, metrics, leftMargin, topMargin, plotWidth, plotHeight);
}

function drawMetricsLegend(ctx, metrics, leftMargin, topMargin, plotWidth, plotHeight) {
    const lines = [];
    if (metrics.riseTime !== null) lines.push({ label: 'Tr:', value: formatMetricValue(metrics.riseTime) + ' s', color: STEP_PLOT.COLORS.riseTime });
    if (metrics.settlingTime !== null) lines.push({ label: 'Ts:', value: formatMetricValue(metrics.settlingTime) + ' s', color: STEP_PLOT.COLORS.settling });
    if (metrics.overshoot !== null) lines.push({ label: 'Mp:', value: formatMetricValue(metrics.overshoot) + ' %', color: STEP_PLOT.COLORS.overshoot });

    if (lines.length === 0) return;

    const padding = 8, lineHeight = 20, boxWidth = 140;
    const boxHeight = padding * 2 + lines.length * lineHeight;
    const boxX = leftMargin + plotWidth - boxWidth - 8;
    const boxY = topMargin + plotHeight - boxHeight - 8;
    const r = 4;

    // Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, r);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.font = STEP_PLOT.FONT;
    lines.forEach((line, i) => {
        const y = boxY + padding + (i + 0.5) * lineHeight;
        ctx.fillStyle = line.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(line.label, boxX + padding, y);
        ctx.fillStyle = CONSTANTS.COLORS.TEXT;
        ctx.textAlign = 'right';
        ctx.fillText(line.value, boxX + boxWidth - padding, y);
    });
}

function formatMetricValue(value) {
    if (value === null || !isFinite(value)) return '--';
    if (Math.abs(value) < 0.001) return value.toExponential(2);
    if (Math.abs(value) < 1) return value.toFixed(3);
    if (Math.abs(value) < 10) return value.toFixed(2);
    if (Math.abs(value) < 100) return value.toFixed(1);
    return value.toFixed(0);
}

// ============================================================================
// Axis Utilities
// ============================================================================

function calculateNiceStep(range, targetSteps) {
    const roughStep = range / targetSteps;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;

    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function formatAxisValue(value) {
    if (Math.abs(value) < 1e-10) return '0';
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
        return value.toExponential(1);
    }
    return parseFloat(value.toPrecision(3)).toString();
}

// ============================================================================
// Step Response Drawing
// ============================================================================

function drawStepResponse(simData, wrapperId, canvasId, options = {}) {
    let ctx, width, height;

    if (options.ctx && options.width && options.height) {
        ctx = options.ctx;
        width = options.width;
        height = options.height;
    } else {
        const wrapper = document.getElementById(wrapperId);
        const canvas = document.getElementById(canvasId);
        if (!wrapper || !canvas) return;

        ctx = canvas.getContext('2d');
        width = wrapper.clientWidth;
        height = wrapper.clientHeight;
        if (width === 0 || height === 0) return;

        canvas.width = width * devicePixelRatio;
        canvas.height = height * devicePixelRatio;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    ctx.fillStyle = options.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (!simData?.time?.length) return;

    const showL = options.showL !== false;
    const showT = options.showT !== false;
    const { left: leftMargin, right: rightMargin, top: topMargin, bottom: bottomMargin } = STEP_PLOT.MARGINS;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = height - topMargin - bottomMargin;

    // Calculate data range
    const tMin = 0, tMax = simData.time[simData.time.length - 1];
    let yMin = 0, yMax = 1, hasData = false;

    for (const [show, data] of [[showL, simData.yL], [showT, simData.yT]]) {
        if (show && data) {
            const valid = data.filter(isFinite);
            if (valid.length > 0) {
                yMin = Math.min(yMin, Math.min(...valid));
                yMax = Math.max(yMax, Math.max(...valid));
                hasData = true;
            }
        }
    }
    if (!hasData) return;

    const yRange = Math.max(yMax - yMin, 0.1);
    yMin -= yRange * 0.1;
    yMax += yRange * 0.1;

    const t2x = t => leftMargin + (t - tMin) / (tMax - tMin) * plotWidth;
    const y2y = y => topMargin + (yMax - y) / (yMax - yMin) * plotHeight;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Grid
    ctx.strokeStyle = CONSTANTS.COLORS.GRID;
    ctx.lineWidth = 1;
    ctx.font = STEP_PLOT.FONT;
    ctx.fillStyle = CONSTANTS.COLORS.TEXT;

    const tStep = calculateNiceStep(tMax - tMin, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= tMax; t += tStep) {
        const x = t2x(t);
        ctx.beginPath();
        ctx.moveTo(x, topMargin);
        ctx.lineTo(x, topMargin + plotHeight);
        ctx.stroke();
        ctx.fillText(formatAxisValue(t), x, topMargin + plotHeight + 8);
    }

    const yStep = calculateNiceStep(yMax - yMin, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
        const py = y2y(y);
        if (py >= topMargin && py <= topMargin + plotHeight) {
            ctx.beginPath();
            ctx.moveTo(leftMargin, py);
            ctx.lineTo(leftMargin + plotWidth, py);
            ctx.stroke();
            ctx.fillText(formatAxisValue(y), leftMargin - 8, py);
        }
    }

    // Reference lines
    ctx.strokeStyle = CONSTANTS.COLORS.AXIS;
    ctx.lineWidth = 1;
    if (yMin < 0 && yMax > 0) {
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(0));
        ctx.lineTo(leftMargin + plotWidth, y2y(0));
        ctx.stroke();
    }
    if (yMin < 1 && yMax > 1) {
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(1));
        ctx.lineTo(leftMargin + plotWidth, y2y(1));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = CONSTANTS.COLORS.TEXT;
    ctx.font = STEP_PLOT.FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time [s]', leftMargin + plotWidth / 2, height - 18);

    ctx.save();
    ctx.translate(18, topMargin + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Response', 0, 0);
    ctx.restore();

    // Draw curve helper
    const drawCurve = (time, data, color, lineWidth, dash = []) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < time.length; i++) {
            if (time[i] > tMax) break;
            const x = t2x(time[i]), y = y2y(data[i]);
            if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    };

    // Snapshots
    if (typeof savedSnapshots !== 'undefined') {
        for (const snap of savedSnapshots) {
            if (!snap.visible || !snap.stepData?.time) continue;
            if (showL && snap.stepData.yL) {
                drawCurve(snap.stepData.time, snap.stepData.yL, lightenColor?.(CONSTANTS.COLORS.L, 0.1) || CONSTANTS.COLORS.L, 1.5, [6, 4]);
            }
            if (showT && snap.stepData.yT) {
                drawCurve(snap.stepData.time, snap.stepData.yT, lightenColor?.(CONSTANTS.COLORS.T, 0.1) || CONSTANTS.COLORS.T, 1.5, [6, 4]);
            }
        }
    }

    // Main curves
    if (showL && simData.yL) drawCurve(simData.time, simData.yL, CONSTANTS.COLORS.L, 2.5);
    if (showT && simData.yT) drawCurve(simData.time, simData.yT, CONSTANTS.COLORS.T, 2.5);

    // Performance metrics
    if (options.showMetrics && showT && simData.yT) {
        const metrics = calculateStepMetrics(simData.time, simData.yT, 1);
        if (metrics) {
            drawStepMetrics(ctx, metrics, t2x, y2y, {
                leftMargin, rightMargin, topMargin, bottomMargin, plotWidth, plotHeight, tMax, yMin, yMax
            });
        }
    }

    // Border
    ctx.strokeStyle = CONSTANTS.COLORS.TEXT;
    ctx.lineWidth = 1;
    ctx.strokeRect(leftMargin, topMargin, plotWidth, plotHeight);
}

// ============================================================================
// Step Response Rendering
// ============================================================================

function renderStepResponsePlot(wrapperId, canvasId, options) {
    const wrapper = document.getElementById(wrapperId);
    const canvas = document.getElementById(canvasId);
    if (!wrapper || !canvas) return;

    const stepTimeMax = getStepTimeMax();

    try {
        const analysis = currentVars.analysis;
        if (!analysis) {
            const ctx = canvas.getContext('2d');
            const width = wrapper.clientWidth, height = wrapper.clientHeight;
            if (width === 0 || height === 0) return;
            canvas.width = width * devicePixelRatio;
            canvas.height = height * devicePixelRatio;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.scale(devicePixelRatio, devicePixelRatio);
            ctx.fillStyle = CONSTANTS.COLORS.BACKGROUND;
            ctx.fillRect(0, 0, width, height);
            return;
        }

        const stepData = analysis.stepResponseData;
        if (!stepData) {
            console.log('Step response: Cannot simulate non-rational transfer function');
            return;
        }

        const structure = analysis.lStructure;
        const { delayL, LCoeffs, ssL } = stepData;

        // Simulation resolution
        let nPoints = 500;
        if (structure.type === 'rational_delay' && delayL > 0) {
            const dtTarget = delayL / 25;
            if (dtTarget > 0) nPoints = Math.max(nPoints, Math.ceil(stepTimeMax / dtTarget) + 1);
            nPoints = Math.min(nPoints, 20000);
        }

        let simData;
        if (structure.type === 'rational_delay') {
            const simL = simulateStepResponse(ssL, null, stepTimeMax, nPoints, delayL, 0);
            const simT = simulateClosedLoopStepResponseLoopDelay(ssL, delayL, stepTimeMax, nPoints);
            simData = { time: simL.time, yL: simL.yL, yT: simT.y };
        } else {
            // Build T = L/(1+L) state-space
            let ssT = null;
            try {
                const maxLen = Math.max(LCoeffs.num.length, LCoeffs.den.length);
                const numPadded = [...LCoeffs.num, ...Array(maxLen - LCoeffs.num.length).fill(0)];
                const denPadded = [...LCoeffs.den, ...Array(maxLen - LCoeffs.den.length).fill(0)];
                const Tden = numPadded.map((n, i) => n + denPadded[i]);
                while (Tden.length > 1 && Math.abs(Tden[Tden.length - 1]) < 1e-15) Tden.pop();
                ssT = tf2ss(LCoeffs.num.slice(), Tden);
            } catch (e) {
                console.log('Step response: Cannot build T state-space:', e);
            }
            simData = simulateStepResponse(ssL, ssT, stepTimeMax, nPoints, 0, 0);
        }

        drawStepResponse(simData, wrapperId, canvasId, options);
    } catch (e) {
        console.log('Step response plot error:', e);
    }
}

function updateStepResponsePlot() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const showL = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-L-step')?.checked ?? true)
        : displayOptions.showLstep;
    const showT = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-T-step')?.checked ?? true)
        : displayOptions.showTstep;

    renderStepResponsePlot(prefix + 'step-wrapper', prefix + 'step-canvas', {
        showL, showT, showMetrics: stepOptions.showMetrics
    });
}
