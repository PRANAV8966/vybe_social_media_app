const { Schema, model } = require('mongoose');

const AUTH_PROVIDERS = ['local', 'google'];

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_.]+$/,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      select: false,
      required: [
        function passwordRequiredForLocalAuth() {
          return this.authProvider === 'local';
        },
        'passwordHash is required for local accounts',
      ],
    },
    authProvider: {
      type: String,
      enum: AUTH_PROVIDERS,
      default: 'local',
      required: true,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    country: {
      type: String,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
      default: null,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

const User = model('User', userSchema);

module.exports = { User, AUTH_PROVIDERS };
