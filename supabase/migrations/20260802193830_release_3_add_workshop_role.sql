-- Release 3: rol operativo para la jefatura de taller.
-- Se mantiene separado porque PostgreSQL no permite usar un valor nuevo de enum
-- dentro de la misma transacción en que se agrega.

alter type public.app_role add value if not exists 'workshop';

