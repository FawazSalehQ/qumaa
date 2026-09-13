const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const { getDocumentProxy } = require(path.resolve(__dirname, '../../node_modules/unpdf'));

const inspectPython = String.raw`
import json, re, sys
from pathlib import Path
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

deck = Presentation(sys.argv[1])
width, height = deck.slide_width, deck.slide_height
slides, warnings = [], []
parts = {str(slide.part.partname): index + 1 for index, slide in enumerate(deck.slides)}
for index, slide in enumerate(deck.slides):
 text, links, captions, pictures = [], [], [], []
 for shape in slide.shapes:
  value = shape.text if shape.has_text_frame else ''
  if value.strip(): text.append(value)
  if shape.name.startswith('screenshot-caption:'):
   captions.append({'name': shape.name.split(':', 1)[1], 'text': value})
  if shape.name.startswith('screenshot:'):
   pictures.append({'name': shape.name.split(':', 1)[1], 'editableImage': shape.shape_type == MSO_SHAPE_TYPE.PICTURE})
  if min(shape.left, shape.top) < -18288 or shape.left + shape.width > width + 18288 or shape.top + shape.height > height + 18288:
   warnings.append({'slide': index + 1, 'shape': shape.name, 'issue': 'Shape extends outside the slide'})
  for element in shape._element.xpath('.//a:hlinkClick'):
   rid = element.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
   if not rid or rid not in slide.part.rels: continue
   relationship = slide.part.rels[rid]
   destination = relationship.target_ref if relationship.is_external else '#slide-' + str(parts.get(str(relationship.target_part.partname), 0))
   if destination == '#slide-0': continue
   link = {'href': destination, 'x': shape.left / width, 'y': shape.top / height, 'width': shape.width / width, 'height': shape.height / height}
   if link not in links: links.append(link)
 note = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ''
 large_images = sum(shape.shape_type == MSO_SHAPE_TYPE.PICTURE and shape.width > 914400 and shape.height > 914400 for shape in slide.shapes)
 missing = [picture['name'] for picture in pictures if not any(caption['name'] == picture['name'] and caption['text'].strip() for caption in captions)]
 slides.append({'number': index + 1, 'name': slide._element.cSld.get('name'), 'texts': text, 'notesPresent': bool(note.strip()), 'editableTextShapes': len(text), 'largeImages': large_images, 'screenshots': pictures, 'captions': captions, 'missingCaptions': missing, 'links': links, 'emDashCount': sum(value.count(chr(0x2014)) for value in text) + note.count(chr(0x2014))})
second = re.sub(r'[\u202a-\u202e\u2066-\u2069]', '', '\n'.join(slides[1]['texts'])) if len(slides) > 1 else ''
print(json.dumps({'slides': len(slides), 'width': width, 'height': height, 'tocOnSecondPage': bool(re.search(r'contents|المحتويات|فهرس', second, re.I)), 'slideDetails': slides, 'shapeWarnings': warnings}, ensure_ascii=False))
`;

function inspectDeck(source) {
  return JSON.parse(cp.execFileSync('python3', ['-c', inspectPython, source], {encoding:'utf8',timeout:60000}));
}

function validationErrors(structure, language) {
  const errors = [];
  const expected = process.env.QUMAA_GUIDE_EXPECTED_SLIDES;
  if (expected && (!/^\d+$/.test(expected) || structure.slides !== Number(expected))) errors.push(`Expected ${expected} slides; found ${structure.slides}`);
  if (!structure.tocOnSecondPage) errors.push('The second slide must contain the table of contents');
  for (const slide of structure.slideDetails) {
    if (!slide.editableTextShapes) errors.push(`Slide ${slide.number} has no editable instructional text`);
    if (!slide.notesPresent) errors.push(`Slide ${slide.number} has no presenter notes`);
    // A slide heading can explain a figure without a separate caption. Validate
    // each authored caption while reporting uncaptained screenshots for review.
    for (const caption of slide.captions) {
      if (!caption.text.trim()) errors.push(`Slide ${slide.number} screenshot caption ${caption.name} is empty`);
      if (!slide.screenshots.some(picture => picture.name===caption.name)) errors.push(`Slide ${slide.number} caption ${caption.name} has no matching screenshot`);
    }
    if (language === 'ar' && slide.emDashCount) errors.push(`Slide ${slide.number} contains an em dash`);
  }
  errors.push(...structure.shapeWarnings.map(warning => `Slide ${warning.slide}: ${warning.shape} extends outside the slide`));
  return errors;
}

const htmlEscape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

async function loadedImages(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
}

// macOS-only layout preview of this generated guide. No AppleEvents, accounts,
// or existing browser profile. This preserves the delivered PPTX unchanged.
// Usage: node presentations/source/render-guide.cjs /private/tmp/qumaa-preview-1
// Apple's Office importer throws on python-pptx speaker notes and bleeds some
// cached shapes across slides. Use isolated, notes-free scratch copies of each
// slide. Their visible slide XML and media stay identical to the source deck.
async function renderGuide({source: defaultSource, outputStem = 'Qumaa_Recruiter_Guide', language = 'en'}) {
  if (process.argv.length !== 3) throw new Error('Usage: node presentations/source/render-guide.cjs /private/tmp/qumaa-preview-1');
  const source = process.env.QUMAA_GUIDE_SOURCE ? path.resolve(process.env.QUMAA_GUIDE_SOURCE) : defaultSource;
  if (!fs.existsSync(source)) throw new Error(`Build ${path.basename(source)} first`);
  const structure = inspectDeck(source);
  const sourceValidationErrors = validationErrors(structure, language);
  if (process.argv[2] === '--check') {
    console.log(JSON.stringify({source, language, structure, validationErrors:sourceValidationErrors}, null, 2));
    if (sourceValidationErrors.length) throw new Error('Source deck validation failed');
    return;
  }
  if (sourceValidationErrors.length) throw new Error(sourceValidationErrors.join('\n'));
  const target = path.resolve(process.argv[2]);
  if (path.dirname(target) !== '/private/tmp') throw new Error('Preview output must be a new directory directly within /private/tmp');
  if (fs.existsSync(target)) throw new Error('Choose a new output directory to avoid overwriting preview files');
  fs.mkdirSync(target);
  const snapshot = path.join(target, 'source.pptx');
  fs.copyFileSync(source, snapshot, fs.constants.COPYFILE_EXCL);
  const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');
  const inputs = path.join(target, 'isolated-slides');
  fs.mkdirSync(inputs);
  cp.execFileSync('python3', ['-c', [
    'import sys',
    'from pathlib import Path',
    'from pptx import Presentation',
    'source, target = sys.argv[1], Path(sys.argv[2])',
    'for selected in range(len(Presentation(source).slides)):',
    ' deck = Presentation(source)',
    ' selected_slide = deck.slides[selected]',
    ' internal_links = set()',
    ' for shape in selected_slide.shapes:',
    '  for element in shape._element.xpath(".//a:hlinkClick"):',
    '   rid = element.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")',
    '   if rid and rid in selected_slide.part.rels and selected_slide.part.rels[rid].reltype.endswith("/slide"):',
    '    internal_links.add(rid)',
    '    element.getparent().remove(element)',
    ' for rid in internal_links: selected_slide.part.drop_rel(rid)',
    ' for index in range(len(deck.slides)-1, -1, -1):',
    '  if index == selected: continue',
    '  element = deck.slides._sldIdLst[index]',
    '  deck.part.drop_rel(element.rId)',
    '  deck.slides._sldIdLst.remove(element)',
    ' for relationship in list(deck.slides[0].part.rels.values()):',
    '  if relationship.reltype.endswith("/notesSlide"): deck.slides[0].part.drop_rel(relationship.rId)',
    ' deck.save(target / f"slide-{selected+1:02}.pptx")',
  ].join('\n'), snapshot, inputs], {stdio:'inherit',timeout:60000});

  const rasterizer = path.join(target, 'pdf-attachment');
  cp.execFileSync('/usr/bin/swiftc', ['-module-cache-path',path.join(target,'swift-module-cache'),path.join(__dirname,'pdf-attachment.swift'),'-o',rasterizer], {stdio:'inherit',timeout:60000});
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = fs.existsSync(systemChrome) ? systemChrome : chromium.executablePath();
  const browser = await chromium.launch({headless:true,executablePath,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
  const report = {source, sourceSha256, language, sourceStructure:structure, slides:0, dimensions:null, notesExcludedFromScratchCopy:true, internalLinksExcludedFromScratchCopy:true, isolatedSlideRendering:true, attachmentCount:0, overflowWarnings:[], images:[], validationErrors:[]};
  try {
    const page = await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:2});
    await page.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith('file:') || url.startsWith('data:') ? route.continue() : route.abort();
    });
    const decks = fs.readdirSync(inputs).filter(name => name.endsWith('.pptx')).sort();
    for (let index=0; index<decks.length; index++) {
      const filename = decks[index];
      cp.execFileSync('/usr/bin/qlmanage', ['-p', '-o', target, path.join(inputs,filename)], {stdio:'pipe', timeout:60000});
      const preview = path.join(target, filename + '.qlpreview');
      let html = fs.readFileSync(path.join(preview,'Preview.html'),'utf8');
      const attachments = fs.readdirSync(preview).filter(name => name.endsWith('.pdf'));
      for (const attachment of attachments) {
        cp.execFileSync(rasterizer,[path.join(preview,attachment),path.join(preview,attachment+'.png')],{stdio:'inherit',timeout:10000});
        html = html.replaceAll(`src="${attachment}"`, `src="${attachment}.png"`);
      }
      const browserHtml = path.join(preview,'BrowserPreview.html');
      fs.writeFileSync(browserHtml,html);
      await page.goto(pathToFileURL(browserHtml).href,{waitUntil:'load'});
      await loadedImages(page);
      await page.addStyleTag({content:'body { margin:0 !important; padding:0 !important; background:white !important; } div.slide { margin:0 !important; box-shadow:none !important; }'});
      const slide = page.locator('div.slide');
      if (await slide.count() !== 1) throw new Error('Expected one isolated slide in Quick Look preview');
      const bounds = await slide.boundingBox();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('Quick Look returned an empty slide');
      if (!report.dimensions) report.dimensions = bounds;
      if (bounds.width !== report.dimensions.width || bounds.height !== report.dimensions.height) throw new Error('Inconsistent slide dimensions');
      const warnings = await page.evaluate(() => [...document.querySelectorAll('div.slide p')].flatMap(paragraph => {
        if (!paragraph.textContent.trim()) return [];
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const text = range.getBoundingClientRect();
        let container = paragraph.parentElement;
        while (container && !container.classList.contains('slide') && getComputedStyle(container).position !== 'absolute') container = container.parentElement;
        if (!container) return [{text:paragraph.textContent,overflowPixels:null,issue:'Text container is missing'}];
        const box = container.getBoundingClientRect();
        const overflow = Math.max(box.left - text.left, text.right - box.right, box.top - text.top, text.bottom - box.bottom);
        return overflow > 3 ? [{text:paragraph.textContent,overflowPixels:Math.round(overflow)}] : [];
      }));
      const imagePath = path.join(target,`slide-${String(index+1).padStart(2,'0')}.png`);
      await slide.screenshot({path:imagePath});
      report.images.push(imagePath);
      report.overflowWarnings.push(...warnings.map(warning => ({slide:index+1,...warning})));
      report.attachmentCount += attachments.length;
      report.slides++;
      console.log(`Rendered ${report.slides}/${decks.length}`);
    }
    const {width,height} = report.dimensions;
    const images = report.images.map((image,index) => {
      const links = structure.slideDetails[index].links.map(link => `<a href="${htmlEscape(link.href)}" style="left:${link.x*width}px;top:${link.y*height}px;width:${link.width*width}px;height:${link.height*height}px"></a>`).join('');
      return `<section class="page" id="slide-${index+1}"><img alt="${language==='ar'?'الشريحة':'Slide'} ${index+1}" src="${pathToFileURL(image).href}">${links}</section>`;
    }).join('');
    const pdfHtml = path.join(target,'PDFPreview.html');
    fs.writeFileSync(pdfHtml,`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>@page {size:${width}px ${height}px; margin:0;} body {margin:0;} .page {position:relative;width:${width}px;height:${height}px;break-after:page;page-break-after:always;} .page:last-child {break-after:auto;page-break-after:auto;} img {display:block;width:100%;height:100%;} .page > a {position:absolute;display:block;}</style></head><body>${images}</body></html>`);
    await page.goto(pathToFileURL(pdfHtml).href,{waitUntil:'load'});
    await loadedImages(page);
    const pdfPath = path.join(target,`${outputStem}_preview.pdf`);
    await page.pdf({path:pdfPath,preferCSSPageSize:true,printBackground:true,margin:{top:0,right:0,bottom:0,left:0}});
    const document = await getDocumentProxy(new Uint8Array(fs.readFileSync(pdfPath)));
    try {
      report.pdf = {path:pdfPath, pages:document.numPages, links:[]};
      for (let number=1;number<=document.numPages;number++) {
        const annotations = await (await document.getPage(number)).getAnnotations();
        for (const annotation of annotations.filter(annotation => annotation.subtype==='Link')) {
          const destination = typeof annotation.dest==='string' ? await document.getDestination(annotation.dest) : annotation.dest;
          const targetPage = Array.isArray(destination) && destination[0] !== undefined ? (typeof destination[0]==='number' ? destination[0] : await document.getPageIndex(destination[0])) + 1 : null;
          report.pdf.links.push({page:number,url:annotation.url ?? null,targetPage});
        }
      }
      if (document.numPages !== structure.slides) report.validationErrors.push(`PDF has ${document.numPages} pages; expected ${structure.slides}`);
      for (const slide of structure.slideDetails) for (const link of slide.links) {
        const internal = /^#slide-(\d+)$/.exec(link.href);
        const found = report.pdf.links.some(actual => actual.page===slide.number && (internal ? actual.targetPage===Number(internal[1]) : actual.url===link.href));
        if (!found) report.validationErrors.push(`PDF hyperlink from slide ${slide.number} to ${link.href} is missing`);
      }
    } finally { await document.loadingTask.destroy(); }
    const contactHtml = path.join(target,'ContactSheet.html');
    fs.writeFileSync(contactHtml,`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>body {margin:0;padding:0;display:grid;grid-template-columns:repeat(3,640px);background:#e6e2ea;font:16px Arial;} figure {margin:0;padding:0;} img {display:block;width:640px;height:${height/width*640}px;} figcaption {padding:8px 12px 16px;}</style></head><body>${report.images.map((image,index)=>`<figure><img src="${pathToFileURL(image).href}"><figcaption dir="${language==='ar'?'rtl':'ltr'}">${language==='ar'?'الشريحة':'Slide'} ${new Intl.NumberFormat(language==='ar'?'ar-SA':'en-US').format(index+1)}</figcaption></figure>`).join('')}</body></html>`);
    await page.setViewportSize({width:1920,height:1200});
    await page.goto(pathToFileURL(contactHtml).href,{waitUntil:'load'});
    await loadedImages(page);
    await page.screenshot({path:path.join(target,'contact-sheet.png'),fullPage:true,scale:'css'});
    report.currentSourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    report.sourceChangedDuringRender = report.currentSourceSha256 !== report.sourceSha256;
    if (report.sourceChangedDuringRender) report.validationErrors.push('The source PPTX changed during rendering; render the current deck again');
    if (report.slides !== structure.slides) report.validationErrors.push('Not all source slides were rendered');
    if (report.overflowWarnings.length) report.validationErrors.push(`${report.overflowWarnings.length} text-overflow warnings need review`);
    fs.writeFileSync(path.join(target,'render-report.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify({source,slides:report.slides,pdfPages:report.pdf.pages,links:report.pdf.links.length,overflowWarnings:report.overflowWarnings,validationErrors:report.validationErrors,report:path.join(target,'render-report.json')}));
    if (report.validationErrors.length) throw new Error(report.validationErrors.join('\n'));
  } catch (error) {
    report.renderError = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(path.join(target,'render-report.json'), JSON.stringify(report,null,2));
    throw error;
  } finally { await browser.close(); }
}

module.exports = {renderGuide, inspectDeck, validationErrors};
if (require.main === module) renderGuide({source:path.resolve(__dirname,'../Qumaa_Recruiter_Guide.pptx')}).catch(error => { console.error(error); process.exitCode=1; });
