const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  nombre: { 
    type: String, 
    required: true,
    trim: true
  },
  correo: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true 
  },
  plan: {
    type: String,
    enum: ['free', 'pro_plus'],
    default: 'free'
  },
  fechaRegistro: { 
    type: Date, 
    default: Date.now 
  }
});

// Middleware limpio y moderno para encriptar la contraseña sin usar "next"
userSchema.pre('save', async function() {
  const user = this;
  if (!user.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
});

// Método para comparar la contraseña cuando el usuario intente hacer login
userSchema.methods.compararPassword = async function(passwordCandidata) {
  return await bcrypt.compare(passwordCandidata, this.password);
};

module.exports = mongoose.model('User', userSchema);