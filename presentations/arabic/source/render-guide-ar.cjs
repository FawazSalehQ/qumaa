const path = require('node:path');
const { renderGuide } = require('../../source/render-guide.cjs');

// Use the same isolated-slide renderer and validation as the English guide.
// Usage: node presentations/arabic/source/render-guide-ar.cjs /private/tmp/qumaa-ar-preview
renderGuide({
  source: path.resolve(__dirname, '../Qumaa_Recruiter_Guide_AR.pptx'),
  outputStem: 'Qumaa_Recruiter_Guide_AR',
  language: 'ar'
}).catch(error => { console.error(error); process.exitCode = 1; });
