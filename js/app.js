class App {
    constructor() {
        this.engine = new AudioEngine();
        this.visualizer = new Visualizer(this.engine);
        this.calculator = new ResonanceCalculator();
        this.ui = new UIController(this);
    }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
