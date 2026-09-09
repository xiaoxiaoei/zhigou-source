export function inlineTeachingText(value){
  const safe=String(value??'').replace(/\\_/g,'_').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return safe.replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');
}
