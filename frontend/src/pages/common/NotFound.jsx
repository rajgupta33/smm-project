import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-gray-100 font-inter antialiased flex flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold tracking-widest text-purple-400 uppercase">404</p>
      <h1 className="text-3xl font-bold">This page doesn&apos;t exist</h1>
      <p className="text-gray-400 max-w-md">
        The page you're looking for was moved or never existed. Head back to a page you know.
      </p>
      <Link
        to="/home"
        className="mt-2 inline-block rounded-lg bg-purple-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-purple-500"
      >
        Go home
      </Link>
    </div>
  );
}
