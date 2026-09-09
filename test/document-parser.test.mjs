import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {parseTeachingDocument,DOCUMENT_FORMATS} from '../src/document-parser.mjs';

test('supported document formats reject renamed or invalid files before model use',async()=>{
  assert.deepEqual(DOCUMENT_FORMATS,['.pptx','.ppt','.docx','.doc','.pdf','.png','.jpg','.jpeg']);
  for(const extension of DOCUMENT_FORMATS)await assert.rejects(parseTeachingDocument(Buffer.from('not a document'),`bad${extension}`),/扩展名不匹配|图片格式不正确/);
  await assert.rejects(parseTeachingDocument(Buffer.from('text'),'file.exe'),/请选择/);
});
test('Word extracts ordered Chinese paragraphs and marks locations as sections',async()=>{
  const zip=new JSZip();zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>第一段：缓存命中。</w:t></w:r></w:p><w:p><w:del><w:r><w:t>已删除错误文字</w:t></w:r></w:del><w:r><w:t>第二段：容量有限 &amp; 需要替换。</w:t></w:r></w:p></w:body></w:document>');
  const buffer=await zip.generateAsync({type:'nodebuffer'}),deck=await parseTeachingDocument(buffer,'测试.DOCX');
  assert.equal(deck.sourceUnit,'section');assert.equal(deck.sourceMode,'word');
  assert.match(deck.slides[0].text,/第一段.*\n第二段/);assert.doesNotMatch(deck.slides[0].text,/已删除/);
  assert.match(deck.slides[0].text,/&/);
  await assert.rejects(parseTeachingDocument(buffer,'test.docx',{maxCharacters:5}),/正文超过/);
});
test('image-only PDF is rejected with an OCR message',async()=>{
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((body,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await assert.rejects(parseTeachingDocument(Buffer.from(pdf),'scan.pdf'),/OCR/);
});
