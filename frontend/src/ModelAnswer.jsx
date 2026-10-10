import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Older answers sometimes contain malformed emphasis such as **结论： **.
// Tidy text nodes only, preserving code, equations in code, and source records.
function tidyEmphasis(){
  return tree=>{
    function walk(node){
      if(node.type==='text')node.value=node.value.replace(/\*\*([^*\n]+)\*\*/g,'$1');
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}
const paragraph=({children})=><p>{children}</p>;
export default function ModelAnswer({text,className='answer-content'}){
  return <div className={className}><Markdown remarkPlugins={[remarkGfm,tidyEmphasis]} skipHtml components={{
    strong:({children})=><span>{children}</span>,
    h1:paragraph,h2:paragraph,h3:paragraph,h4:paragraph,h5:paragraph,h6:paragraph,
    img:()=>null,
    a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table:({children})=><div className="table-scroll"><table>{children}</table></div>,
  }}>{text||''}</Markdown></div>;
}
