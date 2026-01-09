# LoopShaper

A web-based loop shaping control design tool for analyzing and designing feedback control systems.

<https://maruta.github.io/loopshaper/>

## Features

### Visualization Panels

- **Bode Plot**: Gain and phase response visualization for L(s) and T(s)
  - Stability margin lines (GM/PM) and crossover frequency indicators
  - Auto-scaling or custom vertical axis range
  - Auto or manual frequency range adjustment
  - Right-click context menu for display options

- **Nyquist Plot**: Animated Nyquist diagram with advanced features
  - Compressed display mapping (`z → z/(1+|z|/R)`) for infinite curves
  - Adjustable compression radius via mouse wheel
  - Animation controls: play/pause, seek bar, playback speed (1x-8x)
  - Pole indentation visualization for imaginary axis poles
  - Phase markers at 0°, -90°, -180°, -270°

- **Pole-Zero Map**: Visual representation of system poles and zeros
  - Separate display toggles for L(s) and T(s)
  - Synchronized s-plane point during Nyquist animation

- **Step Response**: Time-domain step response visualization
  - Separate display toggles for L(s) and T(s)
  - Auto time range based on dominant pole, or manual setting
  - Right-click context menu for time range options

### Analysis & Control

- **Stability Panel**: Real-time stability analysis
  - Gain Margin (GM) and Phase Margin (PM)
  - Open-loop RHP poles count (P)
  - Nyquist winding number (N)
  - Closed-loop poles display
  - Stability indicator based on Nyquist criterion (Z = N + P)

- **Parameter Sliders**: Interactive controller tuning
  - Linear or logarithmic scale support
  - Real-time plot updates

### System Features

- **Flexible Layout**: Dockview-based resizable and rearrangeable panels for desktop
- **Responsive Design**: Optimized layout for mobile devices with tabbed plot view
- **Share via URL/QR Code**: Share designs using the **Share** button with QR code display. Optionally include panel layout (for PC) or select default plot (for mobile).

## Usage

1. Open <https://maruta.github.io/loopshaper/> in a web browser
2. Enter your transfer function definition in the **System Definition** panel using math.js syntax
3. Add parameter sliders to interactively tune your controller
4. View the Bode plot, Nyquist plot, pole-zero map, step response, and stability analysis in real-time
5. Use the **Share** button to generate a QR code and copy a shareable URL
6. Use the **View** menu to show/hide panels or reset the layout (desktop only)
7. Right-click on Bode or Step Response plots for display options

### Transfer Function Syntax

Define your system using math.js expressions. The variable `s` represents the Laplace variable. The final open-loop transfer function must be assigned to `L`.

Example:

```javascript
K = Kp*(1 + Td*s)
P = 1/(s^2*(s + 1))
L = K * P
```

The tool automatically calculates:

- `T(s) = L(s)/(1+L(s))` - Closed-loop transfer function
- Poles and zeros of both L(s) and T(s)
- Stability based on the Nyquist criterion (Z = N + P)

### Parameters

Add sliders to control parameters in your transfer function:

- **Name**: Variable name used in equations
- **Min/Max**: Slider range
- **Log**: Enable logarithmic scaling for parameters spanning multiple orders of magnitude

## Project Structure

```
loopshaper/
├── index.html      # Main HTML with panel templates and context menus
├── main.js         # Application logic, Dockview setup, state management
├── bode.js         # Bode plot rendering and crossover detection
├── nyquist.js      # Nyquist plot rendering and animation
├── utils.js        # Utility functions and Nyquist contour generation
└── style.css       # Styles for panels and plots
```

## Technologies

- [Shoelace](https://shoelace.style/) - Web component UI library
- [Dockview](https://dockview.dev/) - Flexible panel layout system
- [KaTeX](https://katex.org/) - LaTeX math rendering
- [math.js](https://mathjs.org/) - Mathematical expression parsing and complex number operations
- [pako](https://github.com/nodeca/pako) - zlib compression for URL encoding
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) - QR code generation

## License

MIT License - see [LICENSE](LICENSE) file for details.
