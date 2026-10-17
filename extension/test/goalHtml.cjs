const assert=require('node:assert/strict');
const {goalHtml,goalMarkup}=require('../out/goalHtml');
const {outputText}=require('../out/outputText');
exports.checkGoalHtml=function() {
  const safe=goalHtml('<pre class="source"><span class="free" onclick="alert(1)">n</span> = m<a href="javascript:alert(1)"><span class="main">⇧2</span></a><br>&lt;x&gt;</pre>');
  assert(safe.includes('<span class="free">n</span>'));
  assert(safe.includes('<span class="isabelle-script-sup">2</span>'));
  assert(!safe.includes('⇧'));assert(!safe.includes('href'));assert(!safe.includes('onclick'));
  assert(safe.endsWith('<br>&lt;x&gt;</pre>'));
  for(const input of ['<script>alert(1)</script>','<style>body{display:none}</style>','<svg><a onload="bad()">bad</a></svg>',
    '<img src=x onerror=alert(1)>','<iframe src="file:/etc/passwd"></iframe>','<object><span>bad</span></object>']) assert.equal(goalHtml(input),'',input);
  assert.equal(goalHtml('<span class="free\" onmouseover=\"bad()">ok</span>'),'<span class="free">ok</span>');
  assert.equal(goalHtml('<span style="color:red" class="free x:y a&#32;b">x &amp; y</span>'),'<span class="free">x &amp; y</span>');
  assert(!goalHtml('&lt;script&gt;bad&lt;/script&gt;').includes('<script>'));
  assert(goalHtml('<span>⇧</span><a><span class="free">n</span></a>').includes('isabelle-script-sup'));
  assert.equal(outputText('<span class="free">m⇧2</span>'),'m²');
  const links=goalMarkup('<a class="isabelle-link-99" href="file:/tmp/Theory.thy#27"><span class="const">name</span></a>');
  assert.deepEqual(links.links,[{file:'/tmp/Theory.thy',line:26,label:'name'}]);
  assert(!links.html.includes('href=') && !links.html.includes('isabelle-link-99'));
  assert(links.html.includes('isabelle-link-0'));
  for(const href of ['https://example.com','#2','command:evil','file://remote/tmp/A.thy#2','file:/tmp/A.thy#0','file:/tmp/A.thy?x#2']) {
    assert.equal(goalMarkup('<a href="'+href+'">x</a>').links.length,0,href);
  }
  console.log('PASS: goal HTML allowlist, dangerous elements/attributes, entity escaping and scripts across markup; plain MCP text retained');
};
if(require.main===module) exports.checkGoalHtml();
