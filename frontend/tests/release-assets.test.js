import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSeed} from '../src/domain.js';

test('公开副本的演示素材可在本地读取，默认不请求已排除的视频',()=>{
  const seed=createSeed();
  const paths=new Set(seed.points.map(point=>point.snapshot.url));
  paths.add('/assets/brand-mark.svg');
  for(const path of paths){
    const svg=readFileSync(new URL('../public'+path,import.meta.url),'utf8');
    assert.match(svg,/<svg\b/);
    assert.doesNotMatch(svg,/<script\b|<image\b|(?:href|src)\s*=\s*["']https?:/i);
  }
  assert.ok(seed.points.every(point=>point.streamUrl===null));
});
