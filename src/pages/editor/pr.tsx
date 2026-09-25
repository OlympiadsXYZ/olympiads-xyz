import { Link } from 'gatsby';
import React from 'react';
import Layout from '../../components/layout';
import SEO from '../../components/seo';

export default function EditorPagePr(): JSX.Element {
  return (
    <Layout>
      <SEO title="Предложете редакция" />
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Предложете редакция</h1>
        <p>
          Отворете файла в{' '}
          <Link to="/editor/" className="underline">
            редактора
          </Link>
          , копирайте промените и изберете „Редактирай в GitHub“, за да ги
          изпратите за преглед в Olympiads XYZ.
        </p>
      </main>
    </Layout>
  );
}
