// Step response plotting functionality

// ============================================================================
// Step Time Calculation
// ============================================================================

// Get current step response time range (auto or manual)
function getStepTimeMax() {
    return stepOptions.autoTime ? calculateAutoStepTime() : stepOptions.timeMax;
}

// Calculate step response time range based on dominant closed-loop pole.
// Returns: multiplier / |Re(dominant pole)| if stable, otherwise 20 seconds.
function calculateAutoStepTime() {
    const DEFAULT_TIME = 20;

    try {
        // Check if we have closed-loop poles from stability calculation
        let clPoles = window.lastPoles || [];
        if (clPoles.length === 0) {
            return DEFAULT_TIME;
        }

        // Check if system is stable (all poles in LHP)
        let isStable = clPoles.every(p => p.re < 1e-10);
        if (!isStable) {
            return DEFAULT_TIME;
        }

        // Find the dominant pole (smallest |Re(p)| among stable poles)
        // Dominant pole determines settling time
        let dominantRe = null;
        for (let p of clPoles) {
            // Only consider poles with negative real part (stable)
            if (p.re < -1e-10) {
                let absRe = Math.abs(p.re);
                if (dominantRe === null || absRe < dominantRe) {
                    dominantRe = absRe;
                }
            }
        }

        if (dominantRe === null || dominantRe < 1e-10) {
            return DEFAULT_TIME;
        }

        // Time range = multiplier / |Re(dominant)| (adjustable via mouse wheel)
        let autoTime = stepOptions.autoTimeMultiplier / dominantRe;

        // Clamp to reasonable range
        autoTime = Math.max(0.1, Math.min(1000, autoTime));

        return autoTime;

    } catch (e) {
        console.log('Auto step time calculation error:', e);
        return DEFAULT_TIME;
    }
}

// ============================================================================
// Performance Metrics Calculation
// ============================================================================

// Calculate step response performance metrics from T(s) response.
// Metrics: Tr (rise time 10%-90%), Ts (settling time ±5%), Mp (overshoot %)
// Returns object with metrics or null if calculation fails.
function calculateStepMetrics(time, yT, finalValue = 1) {
    if (!time || !yT || time.length === 0 || yT.length === 0) {
        return null;
    }

    const n = time.length;
    const tol = 0.05; // 5% tolerance for settling time

    // Filter valid data points
    const validIndices = [];
    for (let i = 0; i < n; i++) {
        if (isFinite(yT[i])) {
            validIndices.push(i);
        }
    }
    if (validIndices.length < 2) return null;

    // Determine final value (use last valid value or default)
    let yFinal = finalValue;
    const lastValidIdx = validIndices[validIndices.length - 1];
    if (isFinite(yT[lastValidIdx]) && Math.abs(yT[lastValidIdx] - finalValue) < 0.5) {
        yFinal = finalValue; // Use expected final value for unit step
    }

    // Rise time: time from 10% to 90% of final value
    let t10 = null, t90 = null;
    const y10 = 0.1 * yFinal;
    const y90 = 0.9 * yFinal;
    for (let i = 1; i < n; i++) {
        if (!isFinite(yT[i]) || !isFinite(yT[i - 1])) continue;
        // Find 10% crossing
        if (t10 === null && yT[i - 1] < y10 && yT[i] >= y10) {
            // Linear interpolation
            const ratio = (y10 - yT[i - 1]) / (yT[i] - yT[i - 1]);
            t10 = time[i - 1] + ratio * (time[i] - time[i - 1]);
        }
        // Find 90% crossing
        if (t90 === null && yT[i - 1] < y90 && yT[i] >= y90) {
            const ratio = (y90 - yT[i - 1]) / (yT[i] - yT[i - 1]);
            t90 = time[i - 1] + ratio * (time[i] - time[i - 1]);
        }
    }
    const riseTime = (t10 !== null && t90 !== null) ? (t90 - t10) : null;
    const riseTimeT10 = t10;
    const riseTimeT90 = t90;

    // Peak value and peak time
    let yPeak = yT[0];
    let tPeak = time[0];
    for (let i = 0; i < n; i++) {
        if (isFinite(yT[i]) && yT[i] > yPeak) {
            yPeak = yT[i];
            tPeak = time[i];
        }
    }
    const peakTime = tPeak;

    // Overshoot (percentage)
    let overshoot = null;
    if (yPeak > yFinal && yFinal > 0) {
        overshoot = ((yPeak - yFinal) / yFinal) * 100;
    } else if (yPeak <= yFinal) {
        overshoot = 0;
    }

    // Settling time: time after which response stays within ±tol of final value permanently
    // Search backwards from end to find the last time the response was outside tolerance band
    let settlingTime = null;
    const upperBound = yFinal * (1 + tol);
    const lowerBound = yFinal * (1 - tol);

    // Find the last index where response is outside tolerance band
    let lastOutsideIdx = -1;
    for (let i = n - 1; i >= 0; i--) {
        if (!isFinite(yT[i])) continue;
        if (yT[i] > upperBound || yT[i] < lowerBound) {
            lastOutsideIdx = i;
            break;
        }
    }

    if (lastOutsideIdx === -1) {
        // Response is always within tolerance - settling time is when it first enters the band
        for (let i = 0; i < n; i++) {
            if (isFinite(yT[i]) && yT[i] >= lowerBound && yT[i] <= upperBound) {
                settlingTime = time[i];
                break;
            }
        }
    } else if (lastOutsideIdx < n - 1) {
        // Interpolate between the last outside point and the next inside point
        const i = lastOutsideIdx;
        const j = i + 1;
        if (isFinite(yT[i]) && isFinite(yT[j])) {
            // Determine which boundary was crossed
            if (yT[i] > upperBound) {
                // Crossed upper bound going down
                const ratio = (upperBound - yT[i]) / (yT[j] - yT[i]);
                settlingTime = time[i] + ratio * (time[j] - time[i]);
            } else {
                // Crossed lower bound going up
                const ratio = (lowerBound - yT[i]) / (yT[j] - yT[i]);
                settlingTime = time[i] + ratio * (time[j] - time[i]);
            }
        } else {
            settlingTime = time[j];
        }
    } else {
        // Last point is still outside tolerance - system hasn't settled within simulation time
        settlingTime = null;
    }

    return {
        riseTime,
        riseTimeT10,
        riseTimeT90,
        settlingTime,
        overshoot,
        peakTime,
        peakValue: yPeak,
        finalValue: yFinal
    };
}

// Draw performance metrics annotations on the step response plot.
// Includes: tolerance band (±5%), rise time lines with Tr arrow, settling time line (Ts),
// overshoot indicator (Mp), and a legend box with numeric values.
function drawStepMetrics(ctx, metrics, t2x, y2y, plotInfo) {
    const { leftMargin, topMargin, plotWidth, plotHeight, tMax } = plotInfo;
    const yFinal = metrics.finalValue;

    // Colors for metrics
    const riseTimeColor = '#0066cc';
    const settlingColor = '#009933';
    const overshootColor = '#cc3300';

    ctx.save();

    // Clip to plot area
    ctx.beginPath();
    ctx.rect(leftMargin, topMargin, plotWidth, plotHeight);
    ctx.clip();

    // Draw 5% tolerance band (settling time criterion)
    const upperBound = yFinal * 1.05;
    const lowerBound = yFinal * 0.95;
    const yUpper = y2y(upperBound);
    const yLower = y2y(lowerBound);
    if (yUpper >= topMargin && yLower <= topMargin + plotHeight) {
        ctx.fillStyle = 'rgba(0, 153, 51, 0.1)';
        ctx.fillRect(leftMargin, yUpper, plotWidth, yLower - yUpper);

        // Draw ±5% label at upper right of tolerance band
        ctx.save();
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = settlingColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('±5%', leftMargin + plotWidth - 4, yUpper - 2);
        ctx.restore();
    }

    // Draw rise time indicators (10% and 90% horizontal lines from Y-axis to response curve)
    if (metrics.riseTime !== null && metrics.riseTimeT10 !== null && metrics.riseTimeT90 !== null) {
        const y10 = 0.1 * yFinal;
        const y90 = 0.9 * yFinal;

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = riseTimeColor;

        const py10 = y2y(y10);
        const py90 = y2y(y90);
        const px10 = t2x(metrics.riseTimeT10);
        const px90 = t2x(metrics.riseTimeT90);

        // Horizontal line at 10% (from Y-axis to intersection point)
        if (py10 >= topMargin && py10 <= topMargin + plotHeight && px10 <= leftMargin + plotWidth) {
            ctx.beginPath();
            ctx.moveTo(leftMargin, py10);
            ctx.lineTo(px10, py10);
            ctx.stroke();
            // Vertical line down to time axis at t10
            ctx.beginPath();
            ctx.moveTo(px10, py10);
            ctx.lineTo(px10, topMargin + plotHeight);
            ctx.stroke();
        }

        // Horizontal line at 90% (from Y-axis to intersection point)
        if (py90 >= topMargin && py90 <= topMargin + plotHeight && px90 <= leftMargin + plotWidth) {
            ctx.beginPath();
            ctx.moveTo(leftMargin, py90);
            ctx.lineTo(px90, py90);
            ctx.stroke();
            // Vertical line down to time axis at t90
            ctx.beginPath();
            ctx.moveTo(px90, py90);
            ctx.lineTo(px90, topMargin + plotHeight);
            ctx.stroke();
        }

        // Draw Tr annotation with double-arrow between t10 and t90 on y=0 axis
        const arrowY = y2y(0);
        if (px10 >= leftMargin && px90 <= leftMargin + plotWidth && arrowY >= topMargin && arrowY <= topMargin + plotHeight) {
            const arrowSize = 4;

            ctx.setLineDash([]);
            ctx.strokeStyle = riseTimeColor;
            ctx.fillStyle = riseTimeColor;
            ctx.lineWidth = 1;

            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(px10, arrowY);
            ctx.lineTo(px90, arrowY);
            ctx.stroke();

            // Left arrow head
            ctx.beginPath();
            ctx.moveTo(px10, arrowY);
            ctx.lineTo(px10 + arrowSize, arrowY - arrowSize);
            ctx.lineTo(px10 + arrowSize, arrowY + arrowSize);
            ctx.closePath();
            ctx.fill();

            // Right arrow head
            ctx.beginPath();
            ctx.moveTo(px90, arrowY);
            ctx.lineTo(px90 - arrowSize, arrowY - arrowSize);
            ctx.lineTo(px90 - arrowSize, arrowY + arrowSize);
            ctx.closePath();
            ctx.fill();

            // Tr label
            ctx.font = '11px Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Tr', (px10 + px90) / 2, arrowY + 3);
        }
    }

    // Draw settling time vertical line
    if (metrics.settlingTime !== null && metrics.settlingTime <= tMax) {
        const xSettle = t2x(metrics.settlingTime);
        ctx.strokeStyle = settlingColor;
        ctx.setLineDash([6, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xSettle, topMargin);
        ctx.lineTo(xSettle, topMargin + plotHeight);
        ctx.stroke();
    }

    // Draw overshoot indicator with Mp annotation
    if (metrics.overshoot > 0.1 && metrics.peakTime <= tMax) {
        const xPeak = t2x(metrics.peakTime);
        const yPeakPx = y2y(metrics.peakValue);
        const yFinalPx = y2y(yFinal);
        const arrowSize = 4;

        ctx.strokeStyle = overshootColor;
        ctx.fillStyle = overshootColor;
        ctx.setLineDash([]);
        ctx.lineWidth = 1;

        // Vertical line from final value to peak
        ctx.beginPath();
        ctx.moveTo(xPeak, yFinalPx);
        ctx.lineTo(xPeak, yPeakPx);
        ctx.stroke();

        // Bottom arrow head (at final value)
        ctx.beginPath();
        ctx.moveTo(xPeak, yFinalPx);
        ctx.lineTo(xPeak - arrowSize, yFinalPx - arrowSize);
        ctx.lineTo(xPeak + arrowSize, yFinalPx - arrowSize);
        ctx.closePath();
        ctx.fill();

        // Top arrow head (at peak)
        ctx.beginPath();
        ctx.moveTo(xPeak, yPeakPx);
        ctx.lineTo(xPeak - arrowSize, yPeakPx + arrowSize);
        ctx.lineTo(xPeak + arrowSize, yPeakPx + arrowSize);
        ctx.closePath();
        ctx.fill();

        // Mp label
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Mp', xPeak + 6, (yPeakPx + yFinalPx) / 2);
    }

    ctx.restore();
    ctx.setLineDash([]);

    // Draw Ts label at bottom of settling time line (like time axis label)
    if (metrics.settlingTime !== null && metrics.settlingTime <= tMax) {
        const xSettle = t2x(metrics.settlingTime);
        ctx.font = '12px Consolas, monospace';
        ctx.fillStyle = settlingColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Ts', xSettle, topMargin + plotHeight + 4);
    }

    // Draw Y-axis labels for rise time (0.1 and 0.9) - outside clipping region
    if (metrics.riseTime !== null && metrics.riseTimeT10 !== null && metrics.riseTimeT90 !== null) {
        const y10 = 0.1 * yFinal;
        const y90 = 0.9 * yFinal;
        const py10 = y2y(y10);
        const py90 = y2y(y90);

        ctx.font = '12px Consolas, monospace';
        ctx.fillStyle = riseTimeColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        if (py10 >= topMargin && py10 <= topMargin + plotHeight) {
            ctx.fillText('0.1', leftMargin - 4, py10);
        }
        if (py90 >= topMargin && py90 <= topMargin + plotHeight) {
            ctx.fillText('0.9', leftMargin - 4, py90);
        }
    }

    // Draw metrics legend box
    drawMetricsLegend(ctx, metrics, leftMargin, topMargin, plotWidth, plotHeight);
}

// Draw metrics legend in bottom-right corner of plot
function drawMetricsLegend(ctx, metrics, leftMargin, topMargin, plotWidth, plotHeight) {
    const padding = 8;
    const lineHeight = 16;

    // Prepare metrics text
    const lines = [];
    if (metrics.riseTime !== null) {
        lines.push({ label: 'Tr:', value: formatMetricValue(metrics.riseTime) + ' s', color: '#0066cc' });
    }
    if (metrics.settlingTime !== null) {
        lines.push({ label: 'Ts:', value: formatMetricValue(metrics.settlingTime) + ' s', color: '#009933' });
    }
    if (metrics.overshoot !== null) {
        lines.push({ label: 'Mp:', value: formatMetricValue(metrics.overshoot) + ' %', color: '#cc3300' });
    }

    if (lines.length === 0) return;

    const boxWidth = 130;
    const boxHeight = padding * 2 + lines.length * lineHeight;
    const boxX = leftMargin + plotWidth - boxWidth - 8;
    const boxY = topMargin + plotHeight - boxHeight - 8;

    // Draw background (rounded rectangle)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    const r = 4; // corner radius
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxWidth - r, boxY);
    ctx.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r, r);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
    ctx.arcTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight, r);
    ctx.lineTo(boxX + r, boxY + boxHeight);
    ctx.arcTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r, r);
    ctx.lineTo(boxX, boxY + r);
    ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw metrics
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    lines.forEach((line, i) => {
        const y = boxY + padding + (i + 0.5) * lineHeight;

        // Label
        ctx.fillStyle = line.color;
        ctx.fillText(line.label, boxX + padding, y);

        // Value
        ctx.fillStyle = CONSTANTS.COLORS.TEXT;
        ctx.textAlign = 'right';
        ctx.fillText(line.value, boxX + boxWidth - padding, y);
        ctx.textAlign = 'left';
    });
}

// Format metric value for display
function formatMetricValue(value) {
    if (value === null || value === undefined || !isFinite(value)) return '--';
    if (Math.abs(value) < 0.001) return value.toExponential(2);
    if (Math.abs(value) < 1) return value.toFixed(3);
    if (Math.abs(value) < 10) return value.toFixed(2);
    if (Math.abs(value) < 100) return value.toFixed(1);
    return value.toFixed(0);
}

// ============================================================================
// Axis Utilities
// ============================================================================

// Calculate nice step size for axis
function calculateNiceStep(range, targetSteps) {
    let roughStep = range / targetSteps;
    let magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    let normalized = roughStep / magnitude;

    let niceStep;
    if (normalized <= 1) niceStep = magnitude;
    else if (normalized <= 2) niceStep = 2 * magnitude;
    else if (normalized <= 5) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    return niceStep;
}

// Format axis value for display
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

// Draw step response plot
// When options.ctx/width/height are provided, draws to external context (for SVG export)
// Otherwise, draws to the canvas element specified by wrapperId/canvasId
function drawStepResponse(simData, wrapperId, canvasId, options) {
    options = options || {};

    let ctx, width, height;

    if (options.ctx && options.width && options.height) {
        // External context (SVG export)
        ctx = options.ctx;
        width = options.width;
        height = options.height;
    } else {
        // Canvas context
        let wrapper = document.getElementById(wrapperId);
        let canvas = document.getElementById(canvasId);

        if (!wrapper || !canvas) return;

        ctx = canvas.getContext('2d');

        height = wrapper.clientHeight;
        width = wrapper.clientWidth;

        if (width === 0 || height === 0) return;

        canvas.height = height * devicePixelRatio;
        canvas.width = width * devicePixelRatio;
        canvas.style.height = height + 'px';
        canvas.style.width = width + 'px';

        ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    // Clear canvas
    ctx.fillStyle = options.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (!simData || !simData.time || simData.time.length === 0) return;

    let showL = options.showL !== false;
    let showT = options.showT !== false;

    // Calculate data range
    let tMin = 0;
    let tMax = simData.time[simData.time.length - 1];

    let yMin = 0, yMax = 1;
    let hasData = false;

    if (showL && simData.yL) {
        let validYL = simData.yL.filter(y => isFinite(y));
        if (validYL.length > 0) {
            yMin = Math.min(yMin, Math.min(...validYL));
            yMax = Math.max(yMax, Math.max(...validYL));
            hasData = true;
        }
    }
    if (showT && simData.yT) {
        let validYT = simData.yT.filter(y => isFinite(y));
        if (validYT.length > 0) {
            yMin = Math.min(yMin, Math.min(...validYT));
            yMax = Math.max(yMax, Math.max(...validYT));
            hasData = true;
        }
    }

    if (!hasData) return;

    // Add margin to y range
    let yRange = yMax - yMin;
    if (yRange < 0.1) yRange = 0.1;
    yMin -= yRange * 0.1;
    yMax += yRange * 0.1;

    const leftMargin = 60;
    const rightMargin = 20;
    const topMargin = 20;
    const bottomMargin = 50;
    const plotWidth = width - leftMargin - rightMargin;
    const plotHeight = height - topMargin - bottomMargin;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Coordinate transformations
    let t2x = (t) => leftMargin + (t - tMin) / (tMax - tMin) * plotWidth;
    let y2y = (y) => topMargin + (yMax - y) / (yMax - yMin) * plotHeight;

    // Draw grid
    ctx.strokeStyle = CONSTANTS.COLORS.GRID;
    ctx.lineWidth = 1;
    ctx.font = '14px Consolas, monospace';
    ctx.fillStyle = CONSTANTS.COLORS.TEXT;

    // Time axis grid
    let tStep = calculateNiceStep(tMax - tMin, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= tMax; t += tStep) {
        let x = t2x(t);
        ctx.beginPath();
        ctx.moveTo(x, topMargin);
        ctx.lineTo(x, topMargin + plotHeight);
        ctx.stroke();
        ctx.fillText(formatAxisValue(t), x, topMargin + plotHeight + 8);
    }

    // Y axis grid
    let yStep = calculateNiceStep(yMax - yMin, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
        let py = y2y(y);
        if (py >= topMargin && py <= topMargin + plotHeight) {
            ctx.beginPath();
            ctx.moveTo(leftMargin, py);
            ctx.lineTo(leftMargin + plotWidth, py);
            ctx.stroke();
            ctx.fillText(formatAxisValue(y), leftMargin - 8, py);
        }
    }

    // Draw y=0 line if visible
    if (yMin < 0 && yMax > 0) {
        ctx.strokeStyle = CONSTANTS.COLORS.AXIS;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(0));
        ctx.lineTo(leftMargin + plotWidth, y2y(0));
        ctx.stroke();
    }

    // Draw y=1 line (steady-state reference for closed-loop)
    if (yMin < 1 && yMax > 1) {
        ctx.strokeStyle = CONSTANTS.COLORS.AXIS;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, y2y(1));
        ctx.lineTo(leftMargin + plotWidth, y2y(1));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw axis labels
    ctx.fillStyle = CONSTANTS.COLORS.TEXT;
    ctx.font = '14px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Time [s]', leftMargin + plotWidth / 2, height - 18);

    ctx.save();
    ctx.translate(18, topMargin + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Response', 0, 0);
    ctx.restore();

    // Draw comparison snapshots (behind main curves, as dashed lines)
    if (typeof savedSnapshots !== 'undefined' && savedSnapshots.length > 0) {
        savedSnapshots.forEach((snap) => {
            if (!snap.visible || !snap.stepData || !snap.stepData.time) return;
            const snapTime = snap.stepData.time;

            // Draw L(s) snapshot
            if (showL && snap.stepData.yL) {
                const lightColor = typeof lightenColor === 'function' ? lightenColor(CONSTANTS.COLORS.L, 0.1) : CONSTANTS.COLORS.L;
                ctx.strokeStyle = lightColor;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                let started = false;
                for (let i = 0; i < snapTime.length; i++) {
                    if (snapTime[i] > tMax) break;
                    let x = t2x(snapTime[i]);
                    let y = y2y(snap.stepData.yL[i]);
                    if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                        if (!started) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                }
                ctx.stroke();
            }

            // Draw T(s) snapshot
            if (showT && snap.stepData.yT) {
                const lightColor = typeof lightenColor === 'function' ? lightenColor(CONSTANTS.COLORS.T, 0.1) : CONSTANTS.COLORS.T;
                ctx.strokeStyle = lightColor;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                let started = false;
                for (let i = 0; i < snapTime.length; i++) {
                    if (snapTime[i] > tMax) break;
                    let x = t2x(snapTime[i]);
                    let y = y2y(snap.stepData.yT[i]);
                    if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                        if (!started) {
                            ctx.moveTo(x, y);
                            started = true;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                }
                ctx.stroke();
            }
        });
        ctx.setLineDash([]);
    }

    // Draw L(s) response
    if (showL && simData.yL) {
        ctx.strokeStyle = CONSTANTS.COLORS.L;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < simData.time.length; i++) {
            let x = t2x(simData.time[i]);
            let y = y2y(simData.yL[i]);
            if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
    }

    // Draw T(s) response
    if (showT && simData.yT) {
        ctx.strokeStyle = CONSTANTS.COLORS.T;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < simData.time.length; i++) {
            let x = t2x(simData.time[i]);
            let y = y2y(simData.yT[i]);
            if (isFinite(y) && y >= topMargin - 50 && y <= topMargin + plotHeight + 50) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
    }

    // Draw performance metrics if enabled and T(s) is shown
    if (options.showMetrics && showT && simData.yT) {
        const metrics = calculateStepMetrics(simData.time, simData.yT, 1);
        if (metrics) {
            drawStepMetrics(ctx, metrics, t2x, y2y, {
                leftMargin, rightMargin, topMargin, bottomMargin,
                plotWidth, plotHeight, tMax, yMin, yMax
            });
        }
    }

    // Draw plot border
    ctx.strokeStyle = CONSTANTS.COLORS.TEXT;
    ctx.lineWidth = 1;
    ctx.strokeRect(leftMargin, topMargin, plotWidth, plotHeight);
}

// ============================================================================
// Step Response Rendering
// ============================================================================

// Core step response rendering function
// options: { showL, showT }
function renderStepResponsePlot(wrapperId, canvasId, options) {
    const wrapper = document.getElementById(wrapperId);
    const canvas = document.getElementById(canvasId);

    if (!wrapper || !canvas) return;

    // Get current time range (auto or manual)
    const stepTimeMax = getStepTimeMax();

    try {
        const analysis = currentVars.analysis;
        if (!analysis) {
            // Clear canvas
            const ctx = canvas.getContext('2d');
            const width = wrapper.clientWidth;
            const height = wrapper.clientHeight;
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

        // Get step response data from analysis (lazy evaluation)
        const stepData = analysis.stepResponseData;
        if (!stepData) {
            console.log('Step response: Cannot simulate non-rational transfer function');
            return;
        }

        const structure = analysis.lStructure;
        const delayL = stepData.delayL;
        const LCoeffs = stepData.LCoeffs;
        const ssL = stepData.ssL;

        // Choose simulation resolution.
        // For loop delay, we need reasonably fine dt relative to delay to avoid artifacts.
        let nPoints = 500;
        if (structure.type === 'rational_delay' && delayL > 0) {
            const dtTarget = delayL / 25;
            if (dtTarget > 0) {
                nPoints = Math.max(nPoints, Math.ceil(stepTimeMax / dtTarget) + 1);
            }
            nPoints = Math.min(nPoints, 20000);
        }

        let simData = null;
        let ssT = null;

        if (structure.type === 'rational_delay') {
            // L(s) step response itself is just a pure transport delay on the I/O behavior.
            const simL = simulateStepResponse(ssL, null, stepTimeMax, nPoints, delayL, 0);

            // T(s) must be simulated as a delayed feedback loop:
            //   T(s) = R(s)e^{-sT} / (1 + R(s)e^{-sT})
            // not (R/(1+R))e^{-sT}.
            const simT = simulateClosedLoopStepResponseLoopDelay(ssL, delayL, stepTimeMax, nPoints);

            simData = { time: simL.time, yL: simL.yL, yT: simT.y };
        } else {
            // structure.type === 'rational'
            // Build state-space for T = L/(1+L)
            // T numerator = L numerator
            // T denominator = L denominator + L numerator
            const delayT = 0;
            try {
                const Tnum = LCoeffs.num.slice();
                let Tden = [];

                // Add polynomials: ensure same length
                const maxLen = Math.max(LCoeffs.num.length, LCoeffs.den.length);
                const numPadded = LCoeffs.num.slice();
                const denPadded = LCoeffs.den.slice();
                while (numPadded.length < maxLen) numPadded.push(0);
                while (denPadded.length < maxLen) denPadded.push(0);

                for (let i = 0; i < maxLen; i++) {
                    Tden.push(numPadded[i] + denPadded[i]);
                }

                // Remove trailing zeros
                while (Tden.length > 1 && Math.abs(Tden[Tden.length - 1]) < 1e-15) {
                    Tden.pop();
                }

                ssT = tf2ss(Tnum, Tden);
            } catch (e) {
                console.log('Step response: Cannot build T state-space:', e);
            }

            simData = simulateStepResponse(ssL, ssT, stepTimeMax, nPoints, 0, delayT);
        }

        // Draw
        drawStepResponse(simData, wrapperId, canvasId, options);

    } catch (e) {
        console.log('Step response plot error:', e);
    }
}

// ============================================================================
// Step Response Update
// ============================================================================

function updateStepResponsePlot() {
    const prefix = isNarrowLayout ? 'narrow-' : '';
    const showL = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-L-step')?.checked ?? true)
        : displayOptions.showLstep;
    const showT = isNarrowLayout
        ? (document.getElementById('narrow-chk-show-T-step')?.checked ?? true)
        : displayOptions.showTstep;

    renderStepResponsePlot(prefix + 'step-wrapper', prefix + 'step-canvas', {
        showL: showL,
        showT: showT,
        showMetrics: stepOptions.showMetrics
    });
}
