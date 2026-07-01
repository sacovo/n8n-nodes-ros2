import 'roslib';

// roslib's `Ros` has no built-in way to recover the url it was constructed
// with, but the connection-pool/publisher-cache logic needs it as a cache
// key. Declare the field we stash there so call sites don't need `as any`.
declare module 'roslib' {
    interface Ros {
        socketUrl?: string;
    }
}
