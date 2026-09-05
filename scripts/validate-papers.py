#!/usr/bin/env python3
"""Schema and cross-record checks; no network access and no source mutation."""
import json
import pathlib
import sys
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parent.parent

def validate(root=ROOT):
    schema = json.loads((root / 'content/problems/schema.json').read_text())
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors, paper_ids, problem_ids, count = [], set(), set(), 0
    for file in sorted((root / 'content/problems').rglob('*.json')):
        if file.name == 'schema.json':
            continue
        try:
            data = json.loads(file.read_text())
        except (ValueError, OSError) as error:
            errors.append(f'{file}: {error}')
            continue
        for error in validator.iter_errors(data):
            errors.append(f'{file.relative_to(root)}:{list(error.absolute_path)}: {error.message}')
        paper = data.get('paper', {})
        if paper.get('id') in paper_ids:
            errors.append(f'{file}: duplicate paper id')
        paper_ids.add(paper.get('id'))
        for problem in data.get('problems', []):
            count += 1
            pid = problem.get('id', '')
            if pid in problem_ids or not pid.startswith(paper.get('id', '') + '-') or any(c in pid for c in ('/', '\\', '\x00', '..')):
                errors.append(f'{file}: duplicate, unsafe or unscoped problem id {pid}')
            problem_ids.add(pid)
            for span in problem.get('sourceSpans', []):
                rect = span.get('pdfRect')
                if rect and (rect[0] < 0 or rect[1] < 0 or rect[2] <= rect[0] or rect[3] <= rect[1]):
                    errors.append(f'{pid}: invalid source rectangle')
    print(f'{len(paper_ids)} papers, {count} problems, {len(errors)} validation errors')
    for error in errors:
        print(error, file=sys.stderr)
    return not errors

if __name__ == '__main__':
    sys.exit(0 if validate() else 1)
