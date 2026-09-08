#!/usr/bin/env python3
"""Check the binary variants before publishing them or testing consumers."""
import hashlib
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile


def check(repository, version):
    source = Path(__file__).resolve().parents[1] / 'module/src/main/assets/play-webmcp.js'
    runtime = source.read_bytes()
    declaration = b'export async function registerTools'
    assert runtime.count(declaration) == 1, 'Update classic generation for the new exports'
    classic = (b"(function () {\n'use strict';\n" + runtime.replace(
        declaration, b'async function registerTools') +
        b'\nglobalThis.PlayWebMcp = Object.freeze({ registerTools });\n})();\n')
    variants = [
        ('play-webmcp', 'org.playframework', '3.0.0', '2.13', '2.13.12', 55),
        ('play-webmcp', 'org.playframework', '3.0.0', '3', '3.3.1', 55),
        ('play-webmcp-play29', 'com.typesafe.play', '2.9.0', '2.13', '2.13.12', 55),
        ('play-webmcp-play29', 'com.typesafe.play', '2.9.0', '3', '3.3.1', 55),
        ('play-webmcp-play28', 'com.typesafe.play', '2.8.0', '2.12', '2.12.10', 52),
        ('play-webmcp-play28', 'com.typesafe.play', '2.8.0', '2.13', '2.13.1', 52),
    ]
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    for name, group, play, binary, scala, max_bytecode in variants:
        artifact = f'{name}_{binary}'
        folder = repository / 'io/github/alexusel' / artifact / version
        stem = folder / f'{artifact}-{version}'
        for suffix in ['.jar', '-sources.jar', '-javadoc.jar', '.pom']:
            path = Path(str(stem) + suffix)
            data = path.read_bytes()
            for algorithm in ['sha1', 'md5']:
                expected = Path(str(path) + '.' + algorithm).read_text().strip()
                assert hashlib.new(algorithm, data).hexdigest() == expected, path
        pom = ET.parse(str(stem) + '.pom').getroot()
        assert pom.find('m:artifactId', ns).text == artifact
        assert pom.find('m:version', ns).text == version
        deps = {d.find('m:artifactId', ns).text: d for d in pom.findall('m:dependencies/m:dependency', ns)}
        framework = deps['play_' + binary]
        assert framework.find('m:groupId', ns).text == group, artifact
        assert framework.find('m:version', ns).text == play, artifact
        assert framework.find('m:scope', ns).text == 'provided', artifact
        scala_lib = 'scala3-library_3' if binary == '3' else 'scala-library'
        assert deps[scala_lib].find('m:version', ns).text == scala, artifact
        with zipfile.ZipFile(str(stem) + '.jar') as jar:
            prefix = f'META-INF/resources/webjars/play-webmcp/{version}/'
            assert jar.read(prefix + 'play-webmcp.js') == runtime, artifact
            assert jar.read(prefix + 'play-webmcp.global.js') == classic, artifact
            classes = [entry for entry in jar.namelist() if entry.endswith('.class')]
            assert classes, artifact
            for entry in classes:
                assert int.from_bytes(jar.read(entry)[6:8], 'big') <= max_bytecode, (artifact, entry)
        with zipfile.ZipFile(str(stem) + '-sources.jar') as jar:
            assert jar.read('play-webmcp.js') == runtime
            for required in ['playwebmcp/Tool.java', 'playwebmcp/javadsl/WebMcp.java', 'playwebmcp/scaladsl/WebMcp.scala']:
                assert required in jar.namelist(), (artifact, required)
        print(f'OK {artifact}: Play {play}, Scala {scala}, Java {max_bytecode - 44}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: check-artifacts.py <Maven repository directory> <version>')
    check(Path(sys.argv[1]), sys.argv[2])
