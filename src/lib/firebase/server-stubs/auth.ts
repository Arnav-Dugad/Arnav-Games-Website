import { browserOnly } from "./shared";

export class GoogleAuthProvider {
  constructor() {
    browserOnly("GoogleAuthProvider");
  }
}
export const createUserWithEmailAndPassword = () => browserOnly("createUserWithEmailAndPassword");
export const getAuth = () => browserOnly("getAuth");
export const onAuthStateChanged = () => browserOnly("onAuthStateChanged");
export const sendPasswordResetEmail = () => browserOnly("sendPasswordResetEmail");
export const signInWithEmailAndPassword = () => browserOnly("signInWithEmailAndPassword");
export const signInWithPopup = () => browserOnly("signInWithPopup");
export const signOut = () => browserOnly("signOut");
export const updateProfile = () => browserOnly("updateProfile");
