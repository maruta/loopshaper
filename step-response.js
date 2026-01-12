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
        showT: showT
    });
}
